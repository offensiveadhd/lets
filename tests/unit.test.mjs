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
const { inspectUnique } = await import('../engine/src/registry.mjs');
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
