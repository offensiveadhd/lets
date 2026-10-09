#!/usr/bin/env node
/**
 * lets CLI — for development and for humans.
 *
 *   lets serve [--port N] [--open <unique>]   run the host standalone (no MCP) and print URLs
 *   lets open <unique>                         open a window on an already-running host (or start one)
 *   lets validate [dir]                        validate a unique folder (default: every known unique)
 *   lets uniques                               list uniques
 *   lets entity                                print the companion brief
 *   lets install-skill                         install the bare `/lets` personal skill into ~/.claude/skills
 *   lets doctor                                check node/git/host state
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createEngine, makeLogger } from '../src/engine.mjs';
import { inspectUnique, Registry } from '../src/registry.mjs';
import { Entity } from '../src/entity.mjs';
import { DIRS, ensureDirs, readJson } from '../src/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [cmd = 'help', ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } else positional.push(rest[i]);
}

const print = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));

/** The newest live host run file (optionally on a given port). */
function findHost(port) {
  ensureDirs();
  const runs = fs.readdirSync(DIRS.run).filter((f) => f.startsWith('host-')).map((f) => ({ file: path.join(DIRS.run, f), ...readJson(path.join(DIRS.run, f), {}) }))
    .filter((r) => r.port && (!port || Number(r.port) === Number(port))).sort((a, b) => (b.started || 0) - (a.started || 0));
  for (const r of runs) {
    try { process.kill(r.pid, 0); return r; } catch { try { fs.unlinkSync(r.file); } catch { /* ignore */ } }
  }
  return null;
}

switch (cmd) {
  case 'serve': {
    const log = makeLogger('cli');
    const engine = await createEngine({ port: flags.port ? Number(flags.port) : undefined, log });
    print(`lets host: ${engine.host.origin}  (token in ${engine.host.runFile})`);
    for (const u of engine.host.registry.list()) print(`  ${u.ok ? 'ok ' : 'BAD'} ${u.name.padEnd(12)} ${u.title || ''} ${u.ok ? '' : u.problems.join('; ')}`);
    if (flags.open) {
      const { url } = engine.host.windowUrl(String(flags.open));
      print(`open: ${url}`);
      const tool = engine.tools.find((t) => t.name === 'open');
      if (flags.launch !== 'none') await tool.handler({ unique: String(flags.open), launch: 'system', windowId: new URL(url).hash.match(/w=([^&]+)/)?.[1] });
    }
    if (flags.verbose) {
      setInterval(() => {
        const r = engine.host.bus.read('cli', { max: 100 });
        for (const e of r.events) print(`${new Date(e.ts).toISOString().slice(11, 19)} ${e.from} ${e.type} ${JSON.stringify(e.data).slice(0, 160)}`);
      }, 500);
    }
    await new Promise(() => {});
    break;
  }
  case 'validate': {
    ensureDirs();
    const dirs = positional.length ? positional.map((p) => path.resolve(p)) : new Registry().list().map((u) => u.dir);
    let bad = 0;
    for (const d of dirs) {
      const r = inspectUnique(d);
      print(`${r.ok ? 'ok ' : 'BAD'} ${d}${r.ok ? ` (${r.manifest.name}@${r.manifest.version})` : ''}`);
      for (const p of r.problems) { print(`     - ${p}`); bad++; }
    }
    process.exit(bad ? 1 : 0);
  }
  case 'uniques': { ensureDirs(); print(new Registry().list()); break; }
  case 'url': {
    // print a window URL for a running host:  lets url <unique> [--port N] [--window ID]
    const run = findHost(flags.port);
    if (!run) { print('no running host (start one with: lets serve)'); process.exit(1); }
    const w = flags.window || `w${Date.now().toString(36)}`;
    print(`http://127.0.0.1:${run.port}/u/${positional[0] || 'graph'}/#w=${w}&t=${run.token}`);
    break;
  }
  case 'send': {
    // send a down-command to a running host:  lets send <type> ['{"json":"data"}'] [--to W] [--port N]
    const run = findHost(flags.port);
    if (!run) { print('no running host'); process.exit(1); }
    const [type, json = '{}'] = positional;
    const res = await fetch(`http://127.0.0.1:${run.port}/lip/command${flags.to ? `?to=${encodeURIComponent(flags.to)}` : ''}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-lets-token': run.token }, body: JSON.stringify({ type, data: JSON.parse(json) }),
    });
    print(await res.json());
    break;
  }
  case 'listen': {
    // block until the human does something (plays Claude's attentive loop):  lets listen [--wait MS] [--cursor NAME] [--port N]
    const run = findHost(flags.port);
    if (!run) { print('no running host'); process.exit(1); }
    const res = await fetch(`http://127.0.0.1:${run.port}/lip/listen?cursor=${encodeURIComponent(flags.cursor || 'claude')}&wait_ms=${Number(flags.wait || 30000)}&max=100`, { headers: { 'x-lets-token': run.token } });
    print(await res.json());
    break;
  }
  case 'events': {
    // drain pending events from a running host:  lets events [--cursor NAME] [--port N]
    const run = findHost(flags.port);
    if (!run) { print('no running host'); process.exit(1); }
    const res = await fetch(`http://127.0.0.1:${run.port}/lip/drain?cursor=${encodeURIComponent(flags.cursor || 'cli')}&max=100`, { headers: { 'x-lets-token': run.token } });
    print(await res.json());
    break;
  }
  case 'entity': { ensureDirs(); print(new Entity().brief()); break; }
  case 'install-skill': {
    const dest = path.join(os.homedir(), '.claude', 'skills', 'lets');
    fs.mkdirSync(dest, { recursive: true });
    const src = fs.readFileSync(path.join(root, 'skills', 'lets', 'SKILL.md'), 'utf8')
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, root.replace(/\\/g, '/'))
      .replace(/\$\{CLAUDE_SKILL_DIR\}/g, path.join(root, 'skills', 'lets').replace(/\\/g, '/'));
    fs.writeFileSync(path.join(dest, 'SKILL.md'), src);
    print(`installed personal skill: ${dest}\\SKILL.md  →  use /lets <unique> in any session (needs the lets MCP server; see README)`);
    break;
  }
  case 'doctor': {
    ensureDirs();
    const runs = fs.readdirSync(DIRS.run).filter((f) => f.startsWith('host-')).map((f) => readJson(path.join(DIRS.run, f)));
    print({ node: process.version, root, home: DIRS.home, hosts: runs, uniques: new Registry().list().map((u) => `${u.name}:${u.ok ? 'ok' : 'bad'}`) });
    break;
  }
  default:
    print(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 12).join('\n').replace(/^ \* ?/gm, ''));
}
