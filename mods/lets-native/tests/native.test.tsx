// The native panes: a fake world of lets hosts (run files + /lip/native/* answers,
// the pane calls) and the pane mounted on the desktop and the terminal surfaces.
import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOKEN = 'T0K'
const TREE = (pings: number) => ({
  t: 'Box', p: { flexDirection: 'column' }, c: [
    { t: 'Box', p: { flexDirection: 'row', gap: 1 }, c: [{ t: 'Text', p: { bold: true }, c: ['◉ Doto'] }, { t: 'Button', p: { key: 's.send', label: 'Send to Claude', variant: 'primary' }, c: [] }] },
    { t: 'Button', p: { key: 'u.ping', label: `ping (${pings})` }, c: [] },
    { t: 'Input', p: { key: 'u.note', label: 'note', placeholder: 'type a note' }, c: [] },
    { t: 'Select', p: { key: 'u.kind', label: 'kind', options: [{ value: 'a' }, { value: 'b', label: 'Bee' }], value: 'a' }, c: [] },
    { t: 'Svg', p: { source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', alt: 'the picture', width: 40, height: 40 }, c: [] },
    { t: 'Markdown', p: { text: '**bold**' }, c: [] },
    { t: 'Code', p: { source: 'x = 1', language: 'python' }, c: [] },
    { t: 'Link', p: { href: 'https://example.com', label: 'example' }, c: [] },
    { t: 'Text', p: {}, c: ['plain ', { t: 'Text', p: { dimColor: true }, c: ['nested'] }] },
  ],
})

type Host = { port: number; pings: number; windows: Array<{ id: string; closed?: boolean }>; actions: unknown[]; closes: string[]; syncs: string[] }
type World = { hosts: Host[]; files: number[]; opened: Array<{ id: string; title?: string; columns?: number }>; closed: string[] }
const host = (port: number, windows: Array<{ id: string; closed?: boolean }>): Host => ({ port, pings: 0, windows, actions: [], closes: [], syncs: [] })

/**
 * The world beneath the mod: run files on disk (`files`, one per port), the
 * hosts that answer (`hosts`; a port with a file and no host refuses the
 * connection), and the panes the mod opens and closes. Paths arrive in the
 * OS form, so they are matched loosely.
 */
function world(on: On, hosts: Host[]): World {
  const w: World = { hosts, files: hosts.map((h) => h.port), opened: [], closed: [] }
  mock.env(on, { LETS_HOME: 'C:/fake/.lets' })
  on('fs.exists', (_$, e) => ({ value: /[\\/]run$/.test(e.path) }))
  on('fs.list', () => ({ value: [...w.files.map((port) => ({ name: `host-${port}.json`, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })), { name: 'other.txt', kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.read', (_$, e) => { const port = w.files.find((p) => e.path.endsWith(`host-${p}.json`)); return { value: port ? JSON.stringify({ pid: port, port, token: TOKEN, started: 1, version: '0.7.0' }) : '' } })
  on('http.fetch', (_$, e) => {
    const url = new URL(e.url)
    const h = w.hosts.find((x) => x.port === Number(url.port))
    const headers = e.init?.headers || {}
    if (!h) throw new Error('ECONNREFUSED')
    if (headers['x-lets-token'] !== TOKEN) return { value: { status: 401, ok: false, headers: {}, text: '{"error":"bad token"}' } }
    if (url.pathname === '/lip/native/sync') {
      h.syncs.push(url.search)
      const windows = h.windows.map((x) => ({ id: x.id, unique: 'mini', title: 'mini (native)', columns: 40, rows: 20, rev: 3 + h.pings, closed: !!x.closed, tree: x.closed ? undefined : TREE(h.pings) }))
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ windows, listening: true, ts: 1 }) } }
    }
    if (url.pathname === '/lip/native/action') {
      const act = JSON.parse(String(e.init?.body || '{}'))
      h.actions.push({ w: url.searchParams.get('w'), ...act })
      if (act.key === 'u.ping') h.pings++
      if (act.key === 's.send') return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, rev: 99, closed: true }) } }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, rev: 3 + h.pings, tree: TREE(h.pings) }) } }
    }
    if (url.pathname === '/lip/native/close') { h.closes.push(url.searchParams.get('w') || ''); return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } } }
    if (url.pathname === '/lip/drain') return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ events: [], windows: [{ unique: 'mini', connected: true, mode: 'native' }] }) } }
    if (url.pathname === '/lip/persona') return { value: { status: 200, ok: true, headers: {}, text: '{"name":"Doto","mood":"happy"}' } }
    return { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  on('ui.open', (_$, e) => { w.opened.push({ id: e.id, title: e.title, columns: e.columns }); return { value: { isPlaced: true } } })
  on('ui.close', (_$, e) => { w.closed.push(`${e.id}:${e.origin.kind}`); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  return w
}

const PANE_PROPS = (title: string) => ({ title, isFocused: false, bodyColumns: 56, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} })
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

test('a native window becomes a pane; the pane draws the tree and posts presses, Enters and picks', async ($, on) => {
  const h = host(47999, [{ id: 'W1' }])
  const w = world(on, [h])

  const r = await $.command.run({ command: 'lets-native', args: 'sync', ...RUN })
  expect(r?.text).toContain('lets-w-W1: mini "mini (native)" on :47999')
  expect(w.opened).toEqual([{ id: 'lets-w-W1', title: 'mini (native)', columns: 40 }])
  expect(h.syncs[0]).toContain('known=&v=')

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'lets-native', surface, component: 'Pane', props: PANE_PROPS('mini (native)'), requestId: 'lets-w-W1', viewport: { columns: 60, rows: 30, isFullscreen: true } })
    expect((await ui.find({ type: 'Button', key: 'u.ping' }))?.text).toBe(`ping (${h.pings})`)
    expect((await ui.find({ type: 'Button', key: 's.send' }))?.props.variant).toBe('primary')
    expect(await ui.find({ type: 'Text', text: 'nested' }), `${surface}: a Text inside a Text`).toBeDefined()
    expect(await ui.find({ type: 'Markdown' }), `${surface}: Markdown`).toBeDefined()
    expect(await ui.find({ type: 'Code' }), `${surface}: Code`).toBeDefined()
    expect((await ui.find({ type: 'Link' }))?.props.href, `${surface}: Link`).toBe('https://example.com')
    if (surface === 'desktop') expect((await ui.find({ type: 'Svg' }))?.props.alt, 'desktop: Svg').toBe('the picture')
    else expect(await ui.find({ type: 'Text', text: 'the picture' }), 'terminal: Svg drawn as its alt').toBeDefined()

    const before = h.actions.length
    await ui.press({ key: 'u.ping' })
    expect(h.actions[before]).toEqual({ w: 'W1', key: 'u.ping', kind: 'press' })
    expect((await ui.find({ key: 'u.ping' }))?.text).toBe(`ping (${h.pings})`)
    await ui.input({ key: 'u.note', text: 'a note' })
    expect(h.actions[before + 1]).toEqual({ w: 'W1', key: 'u.note', kind: 'submit', value: 'a note' })
    await ui.select({ key: 'u.kind', value: 'b' })
    expect(h.actions[before + 2]).toEqual({ w: 'W1', key: 'u.kind', kind: 'select', value: 'b' })
    await ui.unmount()
  }

  // the next sync carries what the pane measured, and what it already knows
  await $.command.run({ command: 'lets-native', args: 'sync', ...RUN })
  expect(h.syncs[h.syncs.length - 1]).toContain('known=W1%3A5&v=W1%3A56x30')

  // Send to Claude: the host answers closed → the pane goes, and the host is not told twice
  const ui = await $.ui.mount({ plugin: 'lets-native', surface: 'desktop', component: 'Pane', props: PANE_PROPS('mini (native)'), requestId: 'lets-w-W1' })
  await ui.press({ key: 's.send' })
  expect(w.closed).toEqual(['lets-w-W1:plugin'])
  expect(h.closes).toEqual([])
  expect((await $.command.run({ command: 'lets-native', args: '', ...RUN }))?.text).toContain('No lets native window')
  await ui.unmount()
})

test('a window the host reports closed loses its pane; a host that stops answering takes its windows with it', async ($, on) => {
  const a = host(47999, [{ id: 'W2' }])
  const b = host(48000, [{ id: 'W3' }])
  const w = world(on, [a, b])
  const run = () => $.command.run({ command: 'lets-native', args: 'sync', ...RUN })
  expect((await run())?.text).toContain('2 native window(s)')
  a.windows = [{ id: 'W2', closed: true }]
  expect((await run())?.text).not.toContain('lets-w-W2')
  expect(w.closed).toEqual(['lets-w-W2:plugin'])
  w.hosts.splice(1, 1)                                 // host b died: its run file is still there, the connection is refused
  expect((await run())?.text).toContain('No lets native window')
  expect(w.closed).toEqual(['lets-w-W2:plugin', 'lets-w-W3:plugin'])
})

test('the lets open tool result opens the pane at once and marks that host as this session\'s', async ($, on) => {
  const mine = host(47999, [{ id: 'W4' }])
  const other = host(48000, [{ id: 'W_OTHER' }])
  const w = world(on, [mine, other])
  const answer = { mode: 'native', windowId: 'W4', origin: 'http://127.0.0.1:47999' }
  on('tool.call', { tool: 'mcp__plugin_lets_lets__open' }, () => ({ result: answer, text: JSON.stringify(answer) }))
  await $.tool.call({ tool: 'mcp__plugin_lets_lets__open', unique: 'mini', mode: 'native' })
  expect(w.opened.map((p) => p.id)).toEqual(['lets-w-W4'])
  expect(other.syncs).toEqual([])
  const r = await $.command.run({ command: 'lets-native', args: 'sync', ...RUN })
  expect(r?.text).toContain('lets-w-W4')
  expect(r?.text).not.toContain('W_OTHER')
})
