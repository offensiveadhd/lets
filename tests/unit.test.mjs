import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.LETS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-test-'));

const { validate } = await import('../engine/src/validate.mjs');
const { Bus, matchType } = await import('../engine/src/bus.mjs');
const { Router } = await import('../engine/src/router.mjs');
const { Entity, slug, migratePersona } = await import('../engine/src/entity.mjs');
const { inspectUnique, Registry } = await import('../engine/src/registry.mjs');
const { imageSize } = await import('../engine/src/imagesize.mjs');
const { Sessions, summarize } = await import('../engine/src/sessions.mjs');
const { Store, copyDir } = await import('../engine/src/store.mjs');
const { PLUGIN_ROOT } = await import('../engine/src/paths.mjs');

test('validator: envelope schema accepts a good envelope and rejects a bad one', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'protocol/schemas/envelope.schema.json'), 'utf8'));
  const good = { lip: 1, id: 'ev_ABCDEFGH12', ts: 1, dir: 'up', from: 'unique:graph#w1', type: 'graph.node.select', data: {} };
  assert.equal(validate(schema, good).ok, true);
  const bad = { ...good, dir: 'sideways', type: 'Graph' };
  const r = validate(schema, bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('dir')));
  assert.ok(r.errors.some((e) => e.includes('type')));
});

test('bus: cursors, coalescing, wait, send/pending', async () => {
  const bus = new Bus();
  const mk = (type, extra = {}) => ({ lip: 1, id: 'ev_X', ts: Date.now(), dir: 'up', from: 'unique:graph#w1', type, data: {}, ...extra });
  bus.window('w1', 'graph');
  assert.equal(bus.push(mk('graph.node.select')), true);
  assert.equal(bus.push({ ...mk('x'), dir: 'down' }), false);
  bus.push(mk('graph.changed', { data: { rev: 1 } }));
  bus.push(mk('graph.changed', { data: { rev: 2 } }));
  const r = bus.read('claude');
  assert.deepEqual(r.events.map((e) => e.type), ['graph.node.select', 'graph.changed']);
  assert.equal(r.events[1].data.rev, 2, 'coalesced to latest');
  assert.equal(bus.read('claude').events.length, 0);
  const p = bus.wait('claude', 2000);
  setTimeout(() => bus.push(mk('chat.message')), 20);
  assert.equal(await p, true);
  const s = bus.send({ type: 'entity.say', data: { text: 'hi' } }, 'w1');
  assert.deepEqual(s.queued, ['w1']);
  assert.equal(bus.windows.get('w1').pending.length, 1);
  assert.ok(matchType('graph.*', 'graph.node.add'));
  assert.ok(!matchType('graph.*', 'chat.say'));
});

test('router: tiers, waves, ledger bumps', () => {
  const r = new Router();
  assert.equal(r.route({ kind: 'format', size: 's' }).model, 'haiku');
  assert.equal(r.route({ kind: 'code-edit' }).model, 'sonnet');
  assert.equal(r.route({ kind: 'security', size: 'l' }).model, 'opus');
  for (let i = 0; i < 3; i++) r.report({ kind: 'code-edit', model: 'sonnet', ok: false });
  assert.equal(r.route({ kind: 'code-edit' }).model, 'opus', 'poor ledger bumps a tier');
  const plan = r.plan([{ id: 'a', title: 'a', kind: 'format' }, { id: 'b', title: 'b', kind: 'docs', depends: ['a'] }, { id: 'c', title: 'c', kind: 'docs' }]);
  assert.deepEqual(plan.waves, [['a', 'c'], ['b']]);
  assert.ok(plan.budget.savingsPct > 0);
});

test('entity: persona persists, learns, teaches skills', () => {
  const e = new Entity();
  assert.equal(e.persona.name, 'Doto');
  assert.equal(e.persona.tagline, 'a dot that does');
  e.learn({ text: 'likes tree layouts', likes: ['tree layout'], traits: { chatty: 0 } });
  const e2 = new Entity();
  assert.ok(e2.persona.likes.includes('tree layout'));
  assert.ok(e2.persona.traits.chatty < 0.5);
  const t = e2.teach({ name: 'Screenshot to nodes', triggers: ['screenshot'], body: '## When\nx' });
  assert.equal(t.name, 'screenshot-to-nodes');
  assert.equal(e2.listSkills()[0].triggers[0], 'screenshot');
  assert.equal(e2.reinforce('screenshot-to-nodes', false).confidence < 0.6, true);
  assert.equal(e2.forget('screenshot-to-nodes'), true);
  e2.absorbProfile({ pace: 1500, clickRate: 10, summons: 2, picks: 1 });
  assert.ok(e2.profile.pace > 0);
  assert.equal(slug('Hello World!'), 'hello-world');
});

test('entity: an untouched Pip persona becomes Doto; a renamed one is left alone', () => {
  const pip = { name: 'Pip', tagline: 'small, bright, eager to help', traits: { chatty: 0.9 }, likes: ['tree layout'] };
  assert.deepEqual(migratePersona(pip), { from: 'Pip', to: 'Doto' });
  assert.equal(pip.name, 'Doto');
  assert.equal(pip.tagline, 'a dot that does');
  assert.equal(pip.traits.chatty, 0.9);
  assert.deepEqual(pip.likes, ['tree layout']);
  const nova = { name: 'Nova', tagline: 'small, bright, eager to help' };
  assert.equal(migratePersona(nova), null);
  assert.equal(nova.name, 'Nova');
  const customPip = { name: 'Pip', tagline: 'my own words' };
  assert.equal(migratePersona(customPip), null);
  assert.equal(customPip.name, 'Pip');
});

test('registry: the fixture unique validates; escaping entry is rejected', () => {
  const r = inspectUnique(path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'uniques', 'mini'));
  assert.equal(r.ok, true, r.problems.join('; '));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-u-'));
  fs.writeFileSync(path.join(dir, 'unique.json'), JSON.stringify({ lip: 1, name: 'evil', version: '0.0.1', title: 'x', entry: '../x.html', domains: ['chat'] }));
  const bad = inspectUnique(dir);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => /reserved domain/.test(p)));
  assert.ok(bad.problems.some((p) => /entry/.test(p)));
});

test('sessions: export saves + labels + resume command; summary reads labels', () => {
  const registry = { get: (n) => (n === 'graph' ? { manifest: { domains: ['graph'], session: { export: 'graph.export', snapshot: 'graph.snapshot', restore: 'graph.load' } } } : null) };
  const s = new Sessions({ registry, project: 'C:/p' });
  const mk = (type, data) => ({ lip: 1, id: 'ev_X', ts: Date.now(), dir: 'up', from: 'unique:graph#w9', type, data });
  assert.equal(s.roleOf(mk('graph.export', {})), 'export');
  assert.equal(s.roleOf(mk('graph.snapshot', {})), 'snapshot');
  assert.equal(s.roleOf(mk('graph.changed', {})), null);
  assert.equal(s.roleOf({ ...mk('pulse.export', {}), from: 'unique:pulse#w1' }), 'export', 'fallback <domain>.export for manifests without a session block');
  const graph = { nodes: [{ id: 'a', label: 'Scope' }, { id: 'b', label: 'Recon' }], edges: [{ id: 'e', from: 'a', to: 'b' }] };
  const rec = s.save(mk('graph.export', { graph }), { role: 'export' });
  assert.ok(rec.id.startsWith('s_'));
  assert.equal(rec.data, undefined, 'strip() removes the payload');
  assert.match(rec.summary, /Scope · Recon/);
  assert.match(rec.summary, /2 nodes, 1 edges/);
  const again = s.save(mk('graph.snapshot', { graph: { ...graph, nodes: [...graph.nodes, { id: 'c', label: 'Report' }] } }), { role: 'snapshot' });
  assert.equal(again.id, rec.id, 'same window → same session');
  assert.equal(s.list({ unique: 'graph' }).length, 1);
  assert.equal(s.label('graph', rec.id, 'bounty harness').label, 'bounty harness');
  const got = s.get('graph', 'last');
  assert.equal(got.data.graph.nodes.length, 3);
  const cmd = s.restoreCommand(got);
  assert.equal(cmd.type, 'graph.load');
  assert.equal(cmd.data.graph.nodes.length, 3);
  assert.deepEqual(cmd.data.session, { id: got.id, resumed: true });
  assert.equal(s.get('graph', rec.id.slice(0, 6)).id, rec.id, 'prefix lookup');
  assert.equal(s.remove('graph', rec.id), true);
  assert.equal(s.get('graph', 'last'), null);
  assert.equal(summarize({ title: 'Plan', items: [{ name: 'x' }, { name: 'y' }] }), 'Plan · x · y (2 items)');
  assert.equal(s.handoff, 'close');
});

test('schemas: every file in protocol/schemas parses and is an object schema', () => {
  const dir = path.join(PLUGIN_ROOT, 'protocol', 'schemas');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(typeof doc, 'object', f);
    assert.ok(doc.$schema || doc.type, `${f} looks like a schema`);
  }
  assert.equal(validate(null, {}).ok, false, 'a missing schema is an error, not a crash');
  const uniqueSchema = JSON.parse(fs.readFileSync(path.join(dir, 'unique.schema.json'), 'utf8'));
  const r = validate(uniqueSchema, { lip: 1, name: 'x1', version: '0.0.1', title: 't', entry: 'ui/index.html', domains: ['x1'], events: { 'x1.a': 5 } });
  assert.equal(r.ok, false, 'a non-object event declaration is reported, not thrown');
});

test('store: remove refuses traversal; copyDir skips symlinks and nested .git', () => {
  const store = new Store();
  assert.deepEqual(store.remove('../../etc'), { removed: false, reason: 'bad unique name' });
  assert.deepEqual(store.remove('..'), { removed: false, reason: 'bad unique name' });
  assert.equal(store.remove('nothing-here').removed, false);
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-copy-'));
  fs.mkdirSync(path.join(src, 'ui', '.git'), { recursive: true });
  fs.writeFileSync(path.join(src, 'ui', 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(src, 'ui', '.git', 'HEAD'), 'ref');
  const secret = path.join(src, '..', `lets-secret-${process.pid}.txt`);
  fs.writeFileSync(secret, 'secret');
  let linked = true;
  try { fs.symlinkSync(secret, path.join(src, 'ui', 'leak.txt'), 'file'); } catch { linked = false; }   // needs privileges on some Windows setups
  const dest = path.join(os.tmpdir(), `lets-copy-dest-${process.pid}`);
  copyDir(src, dest);
  assert.ok(fs.existsSync(path.join(dest, 'ui', 'index.html')));
  assert.ok(!fs.existsSync(path.join(dest, 'ui', '.git')), 'nested .git dropped');
  if (linked) assert.ok(!fs.existsSync(path.join(dest, 'ui', 'leak.txt')), 'symlink not copied');
  fs.rmSync(dest, { recursive: true, force: true }); fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(secret, { force: true });
});

test('imagesize: png header', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAADklEQVQIW2NkYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
  assert.deepEqual(imageSize(png), { w: 2, h: 3 });
});

test('entity: den edits — full, set, unlearn (memory by ts), secrets, reset', () => {
  const e = new Entity();
  e.learn({ text: 'den test line', likes: ['den like'], dislikes: ['den dislike'], nicknames: { 'the board': 'graph 1' } });
  const full = e.full();
  assert.ok(full.persona.likes.includes('den like'));
  assert.ok(full.persona.dislikes.includes('den dislike'));
  assert.equal(full.persona.nicknames['the board'], 'graph 1');
  assert.ok(Array.isArray(full.secretsAll) && full.secretsAll.includes('nightcap'));
  assert.equal(full.defaults.name, 'Doto');
  assert.ok(Array.isArray(full.skills) && Array.isArray(full.profile.secrets));
  const line = full.memory.find((m) => m.text === 'den test line');
  assert.ok(line && line.ts > 0 && line.kind === 'note');
  // secrets: counted once, persisted
  assert.equal(e.noteSecret('spin'), true);
  assert.equal(e.noteSecret('spin'), false);
  assert.equal(e.noteSecret('not-a-move'), false);
  e.learn({ text: 'a' }); e.learn({ text: 'b' });
  const ids = e.memory(0).map((m) => m.ts);
  assert.equal(new Set(ids).size, ids.length, 'memory ids are unique');
  assert.equal(e.memory(0).length > 0, true);
  assert.deepEqual(new Entity().profile.secrets, ['spin']);
  // set: direct assignment, clamped, unknown traits and bad colours ignored
  e.set({ name: '  Nova ', tagline: 'a test', traits: { chatty: 2, bogus: 1 }, color: 'red' });
  assert.equal(e.persona.name, 'Nova');
  assert.equal(e.persona.tagline, 'a test');
  assert.equal(e.persona.traits.chatty, 1);
  assert.equal('bogus' in e.persona.traits, false);
  assert.equal(e.persona.color, '#a66bff');
  e.set({ color: '#ff6bd6' });
  assert.equal(e.persona.color, '#ff6bd6');
  // unlearn: exactly these, and the memory line by its ts
  const r = e.unlearn({ likes: ['den like', 'not there'], dislikes: ['den dislike'], nicknames: ['the board'], memory: [line.ts] });
  assert.deepEqual(r.removed, { likes: 1, dislikes: 1, nicknames: 1, memory: 1 });
  assert.equal(e.memory(100).some((m) => m.ts === line.ts), false);
  const e2 = new Entity();
  assert.equal(e2.persona.likes.includes('den like'), false);
  assert.equal('the board' in e2.persona.nicknames, false);
  // reset: persona defaults, memory and secrets kept
  e2.reset();
  assert.equal(e2.persona.name, 'Doto');
  assert.equal(e2.persona.tagline, 'a dot that does');
  assert.equal(e2.persona.traits.chatty, 0.4);
  assert.equal(e2.persona.color, '#a66bff');
  assert.deepEqual(e2.profile.secrets, ['spin']);
});

test('schema: permissions.exec is accepted and validated', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'protocol/schemas/unique.schema.json'), 'utf8'));
  const base = { lip: 1, name: 'xy', version: '0.1.0', title: 'x', entry: 'ui/index.html', domains: ['xy'] };
  assert.equal(validate(schema, { ...base, permissions: { exec: ['python', 'javascript'] } }).ok, true);
  assert.equal(validate(schema, { ...base, permissions: { exec: ['Python!'] } }).ok, false);
  assert.equal(validate(schema, { ...base, permissions: { shell: true } }).ok, false, 'unknown permission keys are still rejected');
});

test('runner: consent persists per unique; config defaults; bad requests', async () => {
  const { Runner } = await import('../engine/src/runner.mjs');
  const r = new Runner();
  assert.equal(r.enabled, true);
  assert.equal(r.allowed('cocode'), false);
  r.setAllowed('cocode', true);
  assert.equal(r.allowed('cocode'), true);
  assert.equal(new Runner().allowed('cocode'), true, 'read back from config.json');
  r.setAllowed('cocode', false);
  assert.equal(r.allowed('cocode'), false);
  const cfg = JSON.parse(fs.readFileSync(path.join(process.env.LETS_HOME, 'config.json'), 'utf8'));
  assert.deepEqual(cfg.runner.allow, {});
  await assert.rejects(r.run({ lang: 'cobol', code: 'x' }), /unknown language/);
  await assert.rejects(r.run({ lang: 'python', code: '   ' }), /empty/);
});

test('runner: javascript runs under the node permission model (fs confined, no children, timeout kills)', async () => {
  const { Runner } = await import('../engine/src/runner.mjs');
  const r = new Runner();
  const langs = await r.languages();
  if (!langs.javascript.ok) { console.log(`skip: ${langs.javascript.reason}`); return; }
  const out = [];
  const ok = await r.run({ lang: 'javascript', code: 'console.log("hi " + require("fs").readdirSync(".").length); console.error("warn")', onChunk: (c) => out.push(c) });
  assert.equal(ok.exit, 0, out.map((c) => c.text).join(''));
  assert.equal(ok.sandbox, 'node-permission');
  assert.ok(out.some((c) => c.stream === 'stdout' && c.text.startsWith('hi ')), 'stdout streamed; the job folder is readable');
  assert.ok(out.some((c) => c.stream === 'stderr' && c.text.includes('warn')));
  const esm = await r.run({ lang: 'javascript', code: 'import os from "node:os"; console.log(typeof os.platform())' });
  assert.equal(esm.exit, 0, 'import syntax picks an ESM file');
  const errs = [];
  const denied = await r.run({ lang: 'javascript', code: `require("fs").readdirSync(${JSON.stringify(os.homedir())})`, onChunk: (c) => errs.push(c) });
  assert.notEqual(denied.exit, 0);
  assert.ok(errs.some((c) => c.stream === 'stderr' && /ERR_ACCESS_DENIED|permission/i.test(c.text)), 'reading outside the job folder is refused');
  const child = await r.run({ lang: 'javascript', code: 'require("child_process").execSync("echo x")' });
  assert.notEqual(child.exit, 0, 'child processes are refused');
  const slow = await r.run({ lang: 'javascript', code: 'for(;;){}', timeoutMs: 1000 });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.killed, 'timeout');
  assert.equal(slow.exit, null);
});

test('runner: python runs under the audit hook (job folder only, no sockets, no subprocesses)', async () => {
  const { Runner } = await import('../engine/src/runner.mjs');
  const r = new Runner();
  const langs = await r.languages();
  if (!langs.python.ok) { console.log(`skip: ${langs.python.reason}`); return; }
  const text = (list) => list.map((c) => c.text).join('');
  const out = [];
  const ok = await r.run({ lang: 'python', code: 'import json, re, pathlib\nopen("a.txt", "w").write("x")\nprint("hi", open("a.txt").read())', onChunk: (c) => out.push(c) });
  assert.equal(ok.exit, 0, text(out));
  assert.equal(ok.sandbox, 'audit-hook');
  assert.ok(out.some((c) => c.stream === 'stdout' && c.text.startsWith('hi x')), 'files inside the job folder work');
  const outside = path.join(process.env.LETS_HOME, 'should-not-exist.txt');
  const e1 = []; const w = await r.run({ lang: 'python', code: `open(${JSON.stringify(outside)}, "w").write("x")`, onChunk: (c) => e1.push(c) });
  assert.notEqual(w.exit, 0);
  assert.ok(!fs.existsSync(outside), 'no file written outside the job folder');
  assert.ok(text(e1).includes('blocked by the lets sandbox: open'), text(e1));
  const e2 = []; const s = await r.run({ lang: 'python', code: 'import socket\ns = socket.socket()\ns.connect(("127.0.0.1", 9))', onChunk: (c) => e2.push(c) });
  assert.notEqual(s.exit, 0);
  assert.ok(text(e2).includes('blocked by the lets sandbox: socket'), text(e2));
  const e3 = []; const p = await r.run({ lang: 'python', code: 'import subprocess\nsubprocess.run(["echo", "x"])', onChunk: (c) => e3.push(c) });
  assert.notEqual(p.exit, 0);
  assert.ok(text(e3).includes('blocked by the lets sandbox: subprocess'), text(e3));
  const e4 = []; const c = await r.run({ lang: 'python', code: 'import ctypes', onChunk: (x) => e4.push(x) });
  assert.notEqual(c.exit, 0);
  assert.ok(text(e4).includes('blocked by the lets sandbox: import ctypes'), text(e4));
  const slow = await r.run({ lang: 'python', code: 'while True: pass', timeoutMs: 1000 });
  assert.equal(slow.timedOut, true);
  const sysexit = await r.run({ lang: 'python', code: 'import sys\nsys.exit(3)' });
  assert.equal(sysexit.exit, 3);
  // the escape an adversarial review found: a raw CreateProcess (a builtin module, so its import raises no
  // audit event) spawned an unguarded child; default-deny now blocks the call itself
  if (process.platform === 'win32') {
    const e5 = []; const w32 = await r.run({ lang: 'python', code: 'import _winapi, sys\n_winapi.CreateProcess(None, sys.executable + " -c pass", None, None, 0, 0, None, None, None)', onChunk: (x) => e5.push(x) });
    assert.notEqual(w32.exit, 0);
    assert.ok(text(e5).includes('blocked by the lets sandbox: _winapi.CreateProcess'), text(e5));
  } else {
    const e5 = []; const fk = await r.run({ lang: 'python', code: 'import os\nos.fork()', onChunk: (x) => e5.push(x) });
    assert.notEqual(fk.exit, 0);
    assert.ok(text(e5).includes('blocked by the lets sandbox: os.fork'), text(e5));
  }
  // unknown events are denied (default-deny), known harmless ones pass
  const e6 = []; const dd = await r.run({ lang: 'python', code: 'import sys\nsys.audit("lets.test.unknown")', onChunk: (x) => e6.push(x) });
  assert.notEqual(dd.exit, 0);
  assert.ok(text(e6).includes('blocked by the lets sandbox: lets.test.unknown'), text(e6));
  const fine = await r.run({ lang: 'python', code: 'import json, re, math, datetime, collections, itertools, functools, pathlib, tempfile, sqlite3, hashlib, random, string, textwrap, dataclasses, typing, io, csv\nwith tempfile.NamedTemporaryFile("w", delete=False) as f: f.write("ok")\nc = sqlite3.connect(":memory:"); c.execute("create table t(x)")\nprint(json.dumps({"ok": True}))' });
  assert.equal(fine.exit, 0, 'a normal stdlib program runs');
});

test('runner: the output cap is enforced before forwarding', async () => {
  const { Runner, LIMITS } = await import('../engine/src/runner.mjs');
  const r = new Runner();
  const langs = await r.languages();
  if (!langs.javascript.ok) { console.log(`skip: ${langs.javascript.reason}`); return; }
  let got = 0; let capMsgs = 0;
  const res = await r.run({ lang: 'javascript', code: 'const s = "A".repeat(65536); for (let i = 0; i < 60; i++) process.stdout.write(s);', onChunk: (c) => { if (c.stream === 'stdout') got += Buffer.byteLength(c.text); if (c.stream === 'system' && c.text.includes('output cap')) capMsgs++; } });
  assert.equal(res.killed, 'output');
  assert.ok(got <= LIMITS.outputBytes, `forwarded ${got} bytes`);
  assert.equal(capMsgs, 1, 'the cap message appears once');
  assert.ok(res.bytes <= LIMITS.outputBytes);
});

test('registry: a symlinked or junctioned unique folder is found', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-link-'));
  const target = path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'uniques', 'mini');
  fs.symlinkSync(target, path.join(parent, 'mini'), 'junction');   // a junction on Windows, a plain symlink elsewhere
  const prev = process.env.LETS_UNIQUES_DIRS;
  process.env.LETS_UNIQUES_DIRS = parent;
  try {
    const reg = new Registry();
    const u = reg.get('mini');
    assert.ok(u && u.ok, 'the linked unique should be registered: ' + JSON.stringify(u?.problems));
  } finally { if (prev === undefined) delete process.env.LETS_UNIQUES_DIRS; else process.env.LETS_UNIQUES_DIRS = prev; }
});
