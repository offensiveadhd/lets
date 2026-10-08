/**
 * lets-native — a mod (Claude Code function hooks) that adds:
 *   /lets <args>   → forwards to the lets plugin's skill (/lets:lets <args>)
 *   /lets-pane     → opens a live pane: hosts, windows, companion mood, latest window events
 *
 * It talks to the lets engine the same way the prompt hook does: reads
 * ~/.lets/run/host-*.json for port + token, then GET /lip/drain?cursor=pane.
 * Nothing here is required for lets to work; it is a convenience layer.
 */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Feed, FeedEvent, HostInfo } from '../types'

const PANE = 'lets'
const EMPTY: Feed = { hosts: [], events: [], mood: 'idle', name: 'Pip', checkedAt: 0 }
const feed = atom({ plugin: 'lets-native', key: 'feed' } as const, EMPTY)

async function homeDir($: any): Promise<string> {
  return (await $.env.get('LETS_HOME')) || (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
}

async function poll($: any): Promise<Feed> {
  const home = await homeDir($)
  const base = home.endsWith('.lets') ? home : `${home}/.lets`
  const runDir = `${base}/run`
  const next: Feed = { ...EMPTY, checkedAt: Date.now() }
  try {
    if (!(await $.fs.exists(runDir))) return next
    const entries = await $.fs.list(runDir)
    for (const ent of entries) {
      const name: string = ent.name ?? ent.path ?? String(ent)
      if (!name.startsWith('host-') || !name.endsWith('.json')) continue
      let run: { port: number; token: string }
      try { run = JSON.parse(await $.fs.read(`${runDir}/${name}`)) } catch { continue }
      const origin = `http://127.0.0.1:${run.port}`
      let res: { ok: boolean; text: string }
      try { res = await $.http.fetch(`${origin}/lip/drain?cursor=pane&max=12`, { headers: { 'x-lets-token': run.token } }) } catch { continue }
      if (!res.ok) continue
      const r = JSON.parse(res.text)
      const windows = (r.windows || []) as { unique: string; connected: boolean }[]
      next.hosts.push({ port: run.port, windows: windows.length, connected: windows.filter((w) => w.connected).length, uniques: [...new Set(windows.map((w) => w.unique))] } as HostInfo)
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
    await $.command.register({ name: 'lets', description: 'Open a lets unique (e.g. /lets graph) — alias for /lets:lets' })
    await $.command.register({ name: 'lets-pane', description: 'Show the lets pane: windows, companion mood, latest window events' })
    const started = await next(e)
    $.clock.every(5000, async () => {
      const fresh = await poll($)
      await update($, feed, (old) => {
        const seen = new Set(old.events.map((x) => `${x.ts}${x.t}`))
        const merged = [...old.events, ...fresh.events.filter((x) => !seen.has(`${x.ts}${x.t}`))].slice(-40)
        return { ...fresh, events: merged }
      })
    })
    return started
  })

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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const f = await read($, feed)
    const rows = Math.max(3, (e.viewport?.rows ?? 24) - 8)
    const ago = f.checkedAt ? `${Math.round((Date.now() - f.checkedAt) / 1000)}s ago` : 'never'
    return (
      <Box flexDirection="column">
        <Text bold>◉ {f.name} · {f.mood}</Text>
        {f.hosts.length === 0 && <Text dimColor>no lets host running — /lets graph starts one</Text>}
        {f.hosts.map((h) => (
          <Text>host :{h.port} · {h.connected}/{h.windows} window(s) {h.uniques.length ? `· ${h.uniques.join(', ')}` : ''}</Text>
        ))}
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
