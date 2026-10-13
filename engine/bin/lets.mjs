#!/usr/bin/env node
/**
 * lets CLI — for development and for humans.
 *
 *   lets serve [--port N] [--open <unique>] [--mode web|native] [--verbose]   run the host standalone (no MCP), print URLs, --verbose prints every up-event
 *   lets url <unique> [--port N] [--window ID] print a window URL for a running host (the token is in it)
 *   lets native <unique> [--port N]            open a NATIVE window on a running host and print its pane as text
 *   lets native --w ID [--act '{json}'] [--close] [--port N]   print a native window's pane; --act {key,kind,value?} acts first
 *   lets send <type> ['{json}'] [--to W] [--port N]   send a down-command to a running host
 *   lets events [--cursor NAME] [--port N]     drain pending up-events from a running host (cursor "events")
 *   lets listen [--wait MS] [--cursor NAME]    block until the human does something (Claude's attentive loop)
 *   lets validate [dir]                        validate a unique folder (default: every known unique)
 *   lets uniques                               list uniques (with the modes each opens in: web, native)
 *   lets defaults [--force] [--only NAME]      install the default uniques (graph, den) from git
 *   lets entity                                print the companion brief
 *   lets sessions [unique] [--rm ID]           list saved sessions (what was sent to Claude), or delete one
 *   lets install-skill                         install the bare `/lets` personal skill into ~/.claude/skills
 *   lets run <lang> <file|-> [--timeout MS]    run a program through the sandbox (python, javascript, typescript); "-" reads stdin
 *   lets doctor                                check node/git/host state and the runner's languages
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createEngine, makeLogger } from '../src/engine.mjs';
import { inspectUnique, Registry } from '../src/registry.mjs';
import { Entity } from '../src/entity.mjs';
import { Sessions } from '../src/sessions.mjs';
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
    for (const u of engine.host.registry.list()) print(`  ${u.ok ? 'ok ' : 'BAD'} ${u.name.padEnd(12)} ${(u.modes || []).join('+').padEnd(10)} ${u.title || ''} ${u.ok ? '' : u.problems.join('; ')}`);
    if (flags.open) {
      const tool = engine.tools.find((t) => t.name === 'open');
      if (flags.mode === 'native') {
        const r = await tool.handler({ unique: String(flags.open), mode: 'native', brief: false });
        print(r.error ? `open: ${r.error}` : `native window ${r.windowId} (${r.title}): ${r.native.howToOpen}`);
      } else {
        const { url } = engine.host.windowUrl(String(flags.open));
        print(`open: ${url}`);
        if (flags.launch !== 'none') await tool.handler({ unique: String(flags.open), launch: 'system', windowId: new URL(url).hash.match(/w=([^&]+)/)?.[1] });
      }
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
  case 'defaults': {
    // install the default uniques listed in defaults.json into ~/.lets/uniques:  lets defaults [--force] [--only NAME]
    ensureDirs();
    const { ensureDefaults, listDefaults } = await import('../src/defaults.mjs');
    const { Store } = await import('../src/store.mjs');
    const reg = new Registry();
    print(`defaults: ${listDefaults().map((u) => `${u.name} (${u.repo})`).join(', ') || 'none'}`);
    const report = await ensureDefaults({ store: new Store(), registry: reg, log: (s, m) => print(`  [${s}] ${m}`), force: !!flags.force, only: flags.only || null });
    for (const r of report) print(`  ${r.status.padEnd(9)} ${r.name}${r.version ? ` @${r.version}` : ''}${r.problems ? ` — ${r.problems.join('; ')}` : ''}`);
    process.exit(report.some((r) => r.status === 'failed') ? 1 : 0);
  }
  case 'url': {
    // print a window URL for a running host:  lets url <unique> [--port N] [--window ID]
    const run = findHost(flags.port);
    if (!run) { print('no running host (start one with: lets serve)'); process.exit(1); }
    const w = flags.window || `w${Date.now().toString(36)}`;
    print(`http://127.0.0.1:${run.port}/u/${positional[0] || 'graph'}/#w=${w}&t=${run.token}`);
    break;
  }
  case 'native': {
    // a native window on a running host, printed as text (docs/NATIVE.md):
    //   lets native <unique> [--port N]                  open one and print its pane
    //   lets native --w ID [--act '{json}'] [--port N]   print a window's pane; --act {key,kind,value?} acts first
    //   lets native --w ID --close [--port N]            close it (as the person would)
    const run = findHost(flags.port);
    if (!run) { print('no running host (start one with: lets serve)'); process.exit(1); }
    const { dumpTree } = await import('../src/native.mjs');
    const base = `http://127.0.0.1:${run.port}`;
    const hdr = { 'content-type': 'application/json', 'x-lets-token': run.token };   // no x-lets-native: the CLI is not the mod
    let w = flags.w ? String(flags.w) : null;
    if (!w) {
      if (!positional[0]) { print('usage: lets native <unique> | lets native --w ID [--act JSON] [--close]'); process.exit(1); }
      const r = await (await fetch(`${base}/lip/native/open`, { method: 'POST', headers: hdr, body: JSON.stringify({ unique: positional[0] }) })).json();
      if (r.error) { print(r); process.exit(1); }
      w = r.windowId;
      print(`native window ${w} (${r.title})`);
    }
    if (flags.act) {
      const r = await (await fetch(`${base}/lip/native/action?w=${encodeURIComponent(w)}`, { method: 'POST', headers: hdr, body: String(flags.act) })).json();
      if (!r.ok) print(`action: ${r.error || 'failed'}`);
    }
    if (flags.close) { print(await (await fetch(`${base}/lip/native/close?w=${encodeURIComponent(w)}`, { method: 'POST', headers: hdr, body: JSON.stringify({ reason: 'cli' }) })).json()); break; }
    const s = await (await fetch(`${base}/lip/native/sync?cols=${Number(flags.cols) || 60}&rows=${Number(flags.rows) || 40}`, { headers: hdr })).json();
    const win = (s.windows || []).find((x) => x.id === w);
    if (!win) { print(`no native window ${w}`); process.exit(1); }
    print(`── ${win.title} · ${win.unique}#${win.id} · rev ${win.rev}${win.closed ? ' · closed' : ''} ──`);
    if (win.tree) process.stdout.write(dumpTree(win.tree));
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
    const res = await fetch(`http://127.0.0.1:${run.port}/lip/drain?cursor=${encodeURIComponent(flags.cursor || 'events')}&max=100`, { headers: { 'x-lets-token': run.token } });
    print(await res.json());
    break;
  }
  case 'entity': { ensureDirs(); print(new Entity().brief()); break; }
  case 'sessions': {
    // saved sessions:  lets sessions [unique] [--rm ID] [--limit N]
    ensureDirs();
    const sessions = new Sessions({ registry: new Registry() });
    if (flags.rm) { print({ removed: sessions.remove(positional[0] || 'graph', String(flags.rm)) }); break; }
    const list = sessions.list({ unique: positional[0] || null, limit: Number(flags.limit) || 20 });
    if (!list.length) { print('no saved sessions (press "Send to Claude" in a window to create one)'); break; }
    for (const s of list) print(`${new Date(s.at).toISOString().slice(0, 16).replace('T', ' ')}  ${s.unique.padEnd(10)} ${s.id.padEnd(14)} ${(s.label || '').padEnd(28)} ${s.summary}`);
    print(`handoff mode: ${sessions.handoff} (set "handoff": "stay" in ${path.join(DIRS.home, 'config.json')} to keep windows open)`);
    break;
  }
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
  case 'run': {
    // run a program through the sandbox:  lets run <lang> <file|-> [--timeout MS]   (docs/RUNNER.md)
    ensureDirs();
    const { Runner } = await import('../src/runner.mjs');
    const [lang, file = '-'] = positional;
    if (!lang) { print('usage: lets run <python|javascript|typescript> <file|-> [--timeout MS]'); process.exit(2); }
    const code = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(file), 'utf8');
    const runner = new Runner({ log: (s, m) => { if (flags.verbose) console.error(`[${s}] ${m}`); } });
    try {
      const r = await runner.run({ lang, code, timeoutMs: flags.timeout ? Number(flags.timeout) : undefined, onChunk: (c) => { (c.stream === 'stdout' ? process.stdout : process.stderr).write(c.text); } });
      console.error(`[lets run] exit ${r.exit}${r.killed ? ` (${r.killed})` : ''} in ${r.ms} ms, ${r.sandbox} sandbox`);
      process.exit(r.exit ?? 1);
    } catch (err) { console.error(`[lets run] ${err.code || 'error'}: ${err.message}`); process.exit(2); }
  }
  case 'doctor': {
    ensureDirs();
    // run files hold the per-host secret token: never print it (doctor output ends up in bug reports)
    const runs = fs.readdirSync(DIRS.run).filter((f) => f.startsWith('host-')).map((f) => { const { token, ...r } = readJson(path.join(DIRS.run, f)) || {}; return { ...r, token: token ? '(redacted)' : undefined }; });
    const { Runner } = await import('../src/runner.mjs');
    const runner = new Runner();
    const langs = await runner.languages();
    print({ node: process.version, root, home: DIRS.home, hosts: runs, uniques: new Registry().list().map((u) => `${u.name}:${u.ok ? 'ok' : 'bad'}`), sessions: new Sessions({ registry: new Registry() }).list({ limit: 5 }).map((s) => `${s.unique}:${s.id}${s.label ? ` (${s.label})` : ''}`), runner: { enabled: runner.enabled, allow: Object.keys(runner.config().allow), languages: Object.fromEntries(Object.entries(langs).map(([k, v]) => [k, v.ok ? `${v.version} (${v.sandbox})` : `no: ${v.reason}`])) } });
    break;
  }
  default:
    print(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 18).join('\n').replace(/^ \* ?/gm, ''));
}
