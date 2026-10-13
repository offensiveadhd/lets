/**
 * lets-native — the Claude Code side of lets, a mod (function hooks, Claude Code 2.1.287+).
 *
 *   /lets <args>          → the lets plugin's skill (/lets:lets <args>)
 *   /lets-pane            → a live pane: hosts, windows, the companion's mood, the latest events
 *   /lets-native [sync]   → the native windows this session shows; `sync` polls the hosts now
 *   native panes          → one pane per native window the lets host holds (docs/NATIVE.md):
 *                           the host runs a unique's view and renders it to a tree of plain nodes;
 *                           this mod draws the tree with the surface's own elements and posts the
 *                           person's presses, Enters and picks back as actions.
 *
 * It talks to the lets host the way the prompt hook does: ~/.lets/run/host-*.json gives port and
 * token; GET /lip/native/sync (every ~1.2 s while a native window is open, every ~3.6 s otherwise),
 * POST /lip/native/action, POST /lip/native/close. A `tool.call` hook on the lets `open` tool makes a
 * new native pane appear right after Claude opened the window, without waiting for a poll, and
 * teaches the mod which host is this session's. Nothing here runs unique code.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'
import type { Feed, FeedEvent, HostInfo, HostRef, NativeState, NativeWindow, Tree, TreeNode } from '../types'

const VERSION = '0.2.0'
const PANE = 'lets'
const PREFIX = 'lets-w-'
const POLL_MS = 1200
const IDLE_EVERY = 3                 // with no native window open, sync every third tick (~3.6 s)
const FEED_EVERY = 4                 // the /lets-pane feed refreshes every fourth tick (~4.8 s)
const EMPTY: Feed = { hosts: [], events: [], mood: 'idle', name: 'Doto', checkedAt: 0 }
const NONE: NativeState = { windows: {}, mine: [] }
const feed = atom({ plugin: 'lets-native', key: 'feed' } as const, EMPTY)
const native = atom({ plugin: 'lets-native', key: 'native' } as const, NONE)

type Kind = 'press' | 'submit' | 'select'
type Table = Record<string, ((props: Record<string, unknown>) => RenderElement) | undefined>
type Viewport = { cols: number; rows: number }
// the elements each surface draws (a table hands out a fragment for a name it lacks, so presence is known here, not probed)
const LACKS: Record<string, ReadonlySet<string>> = { terminal: new Set(['Svg']), mobile: new Set(['Input', 'Select']) }

// module state: lost on a reload, rebuilt from the run files and the host at the next sync
const tokens = new Map<number, string>()         // host port → token (never kept in $.state)
const viewports = new Map<string, Viewport>()    // pane id → what that pane last measured; sent with every sync so each view sizes its picture
let ticks = 0
let busy = false
let again = false

const paneId = (windowId: string) => PREFIX + windowId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 56)
const json = (token: string) => ({ 'content-type': 'application/json', 'x-lets-token': token, 'x-lets-native': VERSION })

async function homeDir($: EngineInterface): Promise<string> {
  const home = (await $.env.get('LETS_HOME')) || (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  const base = home.replace(/\\/g, '/')
  return base.endsWith('.lets') ? base : `${base}/.lets`
}

/** Every live host's run file: port and token. Refreshes the token map. */
async function hosts($: EngineInterface): Promise<HostRef[]> {
  const runDir = `${await homeDir($)}/run`
  const out: HostRef[] = []
  try {
    if (!(await $.fs.exists(runDir))) return out
    for (const ent of await $.fs.list(runDir)) {
      const name = String(ent.name ?? '')
      if (!name.startsWith('host-') || !name.endsWith('.json')) continue
      try {
        const run = JSON.parse(String(await $.fs.read(`${runDir}/${name}`))) as { port?: number; token?: string }
        if (run?.port && run?.token) { out.push({ port: Number(run.port), token: String(run.token) }); tokens.set(Number(run.port), String(run.token)) }
      } catch { /* a half-written run file */ }
    }
  } catch { /* no run folder yet */ }
  return out
}

/**
 * One poll of the hosts: new windows get a pane, closed ones lose it, moved
 * revs bring a fresh tree. A sync asked while one runs is run once more after.
 */
async function sync($: EngineInterface): Promise<void> {
  if (busy) { again = true; return }
  busy = true
  try {
    const all = await hosts($)
    const st = await read($, native)
    const live = st.mine.length && all.some((h) => st.mine.includes(h.port)) ? all.filter((h) => st.mine.includes(h.port)) : all
    const next: Record<string, NativeWindow> = {}
    const missing = new Set(Object.keys(st.windows))
    for (const h of live) {
      const ours = Object.values(st.windows).filter((w) => w.port === h.port)
      const known = ours.map((w) => `${w.id}:${w.rev}`).join(',')
      const sizes = ours.map((w) => { const v = viewports.get(w.pane); return v ? `${w.id}:${v.cols}x${v.rows}` : '' }).filter(Boolean).join(',')
      let res: { ok: boolean; status: number; text: string }
      try { res = await $.http.fetch(`http://127.0.0.1:${h.port}/lip/native/sync?known=${encodeURIComponent(known)}&v=${encodeURIComponent(sizes)}`, { headers: { 'x-lets-token': h.token, 'x-lets-native': VERSION } }) } catch { continue }
      if (!res.ok) continue
      let r: { windows?: Array<{ id: string; unique: string; title: string; columns?: number; rows?: number; rev: number; closed?: boolean; tree?: TreeNode }> }
      try { r = JSON.parse(res.text) } catch { continue }
      for (const w of r.windows || []) {
        const prev = st.windows[w.id]
        next[w.id] = { id: w.id, pane: paneId(w.id), port: h.port, unique: w.unique, title: w.title, columns: w.columns || 56, rows: w.rows || 40, rev: w.rev, tree: w.tree ?? prev?.tree ?? null, closed: !!w.closed }
        missing.delete(w.id)
      }
    }
    for (const id of missing) { const w = st.windows[id]; if (w) next[id] = { ...w, closed: true } }   // its host is gone or forgot it
    const opened: NativeWindow[] = []
    const closed: NativeWindow[] = []
    for (const w of Object.values(next)) {
      if (w.closed) { if (st.windows[w.id]) closed.push(w); delete next[w.id] }     // a close is acted on once
      else if (!st.windows[w.id]) opened.push(w)
    }
    await update($, native, (s) => ({ ...s, windows: next }))
    for (const w of opened) await $.ui.open({ id: w.pane, title: w.title, columns: w.columns, rows: w.rows, focus: true })
    for (const w of closed) { viewports.delete(w.pane); await $.ui.close({ id: w.pane }) }
  } finally {
    busy = false
    if (again) { again = false; void sync($) }
  }
}

/** The person acted in a pane: tell the host, draw what it answers. */
async function act($: EngineInterface, w: NativeWindow, key: string, kind: Kind, value?: string): Promise<void> {
  let token = tokens.get(w.port)
  if (!token) { await hosts($); token = tokens.get(w.port) }
  if (!token) { $.ui.toast(`lets: no run file for the host on :${w.port}`); return }
  let res: { ok: boolean; status: number; text: string }
  try {
    res = await $.http.fetch(`http://127.0.0.1:${w.port}/lip/native/action?w=${encodeURIComponent(w.id)}`, { method: 'POST', headers: json(token), body: JSON.stringify({ key, kind, ...(value !== undefined ? { value } : {}) }) })
  } catch { $.ui.toast(`lets: the host on :${w.port} is not answering`); return }
  if (!res.ok) { $.ui.toast(`lets: the action failed (${res.status})`); return }
  let r: { ok?: boolean; rev?: number; tree?: TreeNode; closed?: boolean; error?: string }
  try { r = JSON.parse(res.text) } catch { return }
  await update($, native, (s) => {
    const cur = s.windows[w.id]
    if (!cur) return s
    if (r.closed) { const windows = { ...s.windows }; delete windows[w.id]; return { ...s, windows } }
    return { ...s, windows: { ...s.windows, [w.id]: { ...cur, rev: r.rev ?? cur.rev, tree: r.tree ?? cur.tree } } }
  })
  if (r.closed) { viewports.delete(w.pane); await $.ui.close({ id: w.pane }) }
}

/** The text a node shows, for a label: its string children, through nested Text. */
function textOf(node: Tree): string {
  if (typeof node === 'string') return node
  return (node.c || []).map(textOf).join('')
}

/**
 * A host tree (docs/NATIVE.md §3) as the surface's elements: every node is
 * `{t, p, c}` or a string; presses, Enters and picks become actions. An
 * element the surface lacks (Svg on the terminal, Input on mobile) draws as
 * text so the pane still reads.
 */
function draw(table: Table, surface: string, node: Tree, on: (key: string, kind: Kind, value?: string) => void): RenderElement | string {
  if (typeof node === 'string') return node
  const p: Record<string, unknown> = { ...(node.p || {}) }
  const key = String(p.key ?? '')
  const kids = (node.c || []).map((c) => draw(table, surface, c, on)).filter((x) => x != null)
  const T = LACKS[surface]?.has(node.t) ? undefined : table[node.t]
  const Text = table.Text!
  const text = (s: string, dim = true) => Text({ dimColor: dim, children: s })
  switch (node.t) {
    case 'Box': return (table.Box ?? Text)({ ...p, children: kids })
    case 'Text': return Text({ ...p, children: kids })
    case 'Button': return (table.Button ?? Text)({ ...p, label: typeof p.label === 'string' ? p.label : textOf(node), onPress: () => on(key, 'press') })
    case 'Input': return T ? T({ ...p, onSubmit: (v: string) => on(key, 'submit', v) }) : text(`${p.label ? `${p.label}: ` : ''}${p.value ?? p.placeholder ?? ''}`)
    case 'Select': return T ? T({ ...p, onSelect: (v: string) => on(key, 'select', v) }) : text(`${p.label ? `${p.label}: ` : ''}${p.value ?? ''}`)
    case 'Svg': return T ? T(p) : text(String(p.alt || '[picture]'))
    case 'Markdown': return T ? T(p) : text(String(p.text ?? ''), false)
    case 'Code': return T ? T(p) : text(String(p.source ?? ''), false)
    case 'Link': return T ? T(p) : text(`${p.label ?? p.href} <${p.href}>`, false)
    default: return text(`[${node.t}]`)
  }
}

/** The /lets-pane feed: every host's windows, the companion, the latest events. */
async function poll($: EngineInterface): Promise<Feed> {
  const next: Feed = { ...EMPTY, checkedAt: Date.now() }
  try {
    for (const run of await hosts($)) {
      const origin = `http://127.0.0.1:${run.port}`
      let res: { ok: boolean; text: string }
      try { res = await $.http.fetch(`${origin}/lip/drain?cursor=pane&max=12`, { headers: { 'x-lets-token': run.token } }) } catch { continue }
      if (!res.ok) continue
      const r = JSON.parse(res.text)
      const windows = (r.windows || []) as { unique: string; connected: boolean; mode?: string }[]
      next.hosts.push({ port: run.port, windows: windows.length, connected: windows.filter((w) => w.connected).length, native: windows.filter((w) => w.mode === 'native').length, uniques: [...new Set(windows.map((w) => w.unique))] } as HostInfo)
      for (const e of r.events || []) {
        const data = JSON.stringify(e.data ?? {})
        next.events.push({ t: e.type, from: String(e.from).replace(/^unique:/, ''), ts: e.ts, data: data.length > 90 ? data.slice(0, 90) + '…' : data } as FeedEvent)
      }
      try {
        const p = await $.http.fetch(`${origin}/lip/persona`, { headers: { 'x-lets-token': run.token } })
        if (p.ok) { const persona = JSON.parse(p.text); next.mood = persona.mood || next.mood; next.name = persona.name || next.name }
      } catch { /* optional */ }
    }
  } catch (err) {
    next.error = String((err as Error)?.message || err)
  }
  return next
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lets', description: 'Open a lets unique (e.g. /lets graph, /lets graph native) — alias for /lets:lets' })
    await $.command.register({ name: 'lets-pane', description: 'Show the lets pane: windows, companion mood, latest window events' })
    await $.command.register({ name: 'lets-native', description: 'List the lets native windows shown in this session; "sync" polls the hosts now' })
    const started = await next(e)
    // panes a reload left behind: the engine keeps them, the module's state says which windows they show
    try {
      const st = await read($, native)
      const panes = await $.ui.panes()
      for (const w of Object.values(st.windows)) if (!panes.some((p) => p.id === w.pane)) await $.ui.open({ id: w.pane, title: w.title, columns: w.columns, rows: w.rows })
    } catch { /* drawn later */ }
    $.clock.every(POLL_MS, async () => {
      ticks++
      const st = await read($, native)
      if (Object.keys(st.windows).length || ticks % IDLE_EVERY === 0) await sync($)
      if (ticks % FEED_EVERY === 0) {
        const fresh = await poll($)
        await update($, feed, (old) => {
          const seen = new Set(old.events.map((x) => `${x.ts}${x.t}`))
          const merged = [...old.events, ...fresh.events.filter((x) => !seen.has(`${x.ts}${x.t}`))].slice(-40)
          return { ...fresh, events: merged }
        })
      }
    })
    return started
  })

  // the lets `open` tool answered: a native window wants its pane now, and its host is this session's
  for (const tool of ['mcp__plugin_lets_lets__open', 'mcp__lets__open'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const r = await next(e)
      try {
        const text = (r as { text?: string }).text
        const j = text ? JSON.parse(text) as { mode?: string; origin?: string } : null
        if (j?.origin) {
          const port = Number(new URL(j.origin).port)
          if (port) await update($, native, (s) => (s.mine.includes(port) ? s : { ...s, mine: [...s.mine, port] }))
        }
        if (j?.mode === 'native') await sync($)
      } catch { /* not a lets result */ }
      return r
    }).catch(($, e, next) => next(e))      // whatever went wrong here, the tool's own result stands
  }

  on('command.run', { command: 'lets' }, async ($, e) => {
    const args = (e.args || '').trim()
    const skill = args ? `/lets:lets ${args}` : '/lets:lets list'
    return {
      text: `lets → ${skill}`,
      context: [
        `The person ran "/lets ${args}". Run the lets skill now: invoke the Skill tool with skill "lets:lets" and args "${args || 'list'}". ` +
        'If that skill is not available, tell them the lets plugin is not installed (/plugin marketplace add TikoTikTok/lets, then /plugin install lets@lets).',
      ],
    }
  })

  on('command.run', { command: 'lets-pane' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'lets' })
    return { text: 'lets pane opened.' }
  })

  on('command.run', { command: 'lets-native' }, async ($, e) => {
    if (/\bsync\b/.test(e.args || '')) await sync($)
    const st = await read($, native)
    const list = Object.values(st.windows)
    const lines = list.map((w) => `${w.pane}: ${w.unique} "${w.title}" on :${w.port}, rev ${w.rev}${w.tree ? '' : ' (no tree yet)'}`)
    return { text: list.length ? `${list.length} native window(s):\n${lines.join('\n')}` : 'No lets native window is open. /lets graph native opens one (lets 0.7.0+).' }
  })

  // the person closed a native pane: the host drops the window; closed by this mod: the host already knows
  on('ui.close', async ($, e, next) => {
    if (!e.id.startsWith(PREFIX)) return next(e)
    const r = await next(e)
    viewports.delete(e.id)
    const st = await read($, native)
    const w = Object.values(st.windows).find((x) => x.pane === e.id)
    if (w) {
      await update($, native, (s) => { const windows = { ...s.windows }; delete windows[w.id]; return { ...s, windows } })
      if (e.origin.kind === 'person') {
        const token = tokens.get(w.port) || (await hosts($), tokens.get(w.port))
        if (token) { try { await $.http.fetch(`http://127.0.0.1:${w.port}/lip/native/close?w=${encodeURIComponent(w.id)}`, { method: 'POST', headers: json(token), body: JSON.stringify({ reason: 'person' }) }) } catch { /* host gone */ } }
      }
    }
    return r
  }).catch(($, e, next) => next(e))        // a failure here must never keep a pane open

  // a native window's pane: the host's tree, drawn with this surface's elements
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (!e.requestId.startsWith(PREFIX)) return next(e)
    const cols = e.props.bodyColumns || e.viewport?.columns || 0
    const rows = e.viewport?.rows || 0
    if (cols) viewports.set(e.requestId, { cols, rows })
    const table = $.ui.resolve(e) as unknown as Table
    const st = await read($, native)
    const w = Object.values(st.windows).find((x) => x.pane === e.requestId)
    if (!w) return table.Text!({ dimColor: true, children: 'This lets window is gone. Close the pane, or /lets graph native for a new one.' })
    if (!w.tree) return table.Text!({ dimColor: true, children: `${w.title}: waiting for the lets host on :${w.port}…` })
    const drawn = draw(table, e.surface, w.tree, (key, kind, value) => { void act($, w, key, kind, value) })
    return typeof drawn === 'string' ? table.Text!({ children: drawn }) : drawn
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const f = await read($, feed)
    const st = await read($, native)
    const rows = Math.max(3, (e.viewport?.rows ?? 24) - 9)
    const ago = f.checkedAt ? `${Math.round((Date.now() - f.checkedAt) / 1000)}s ago` : 'never'
    const nativeCount = Object.keys(st.windows).length
    return (
      <Box flexDirection="column">
        <Text bold>◉ {f.name} · {f.mood}</Text>
        {f.hosts.length === 0 && <Text dimColor>no lets host running — /lets graph starts one</Text>}
        {f.hosts.map((h) => (
          <Text>host :{h.port} · {h.connected}/{h.windows} window(s){h.native ? ` · ${h.native} native` : ''} {h.uniques.length ? `· ${h.uniques.join(', ')}` : ''}</Text>
        ))}
        <Text dimColor>{nativeCount ? `${nativeCount} native pane(s) in this session` : 'no native pane here — /lets graph native opens one'}</Text>
        <Text dimColor>── events (checked {ago}) ──</Text>
        {f.events.length === 0 && <Text dimColor>nothing yet</Text>}
        {f.events.slice(-rows).map((ev) => (
          <Text>
            <Text dimColor>{new Date(ev.ts).toISOString().slice(11, 19)} </Text>
            <Text color="magenta">{ev.t}</Text>
            <Text dimColor> {ev.data}</Text>
          </Text>
        ))}
        {f.error && <Text color="red">{f.error}</Text>}
      </Box>
    )
  })
}
