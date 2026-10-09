import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.LETS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-test-'));

const { validate } = await import('../engine/src/validate.mjs');
const { Bus, matchType } = await import('../engine/src/bus.mjs');
const { Router } = await import('../engine/src/router.mjs');
const { Entity, slug } = await import('../engine/src/entity.mjs');
const { inspectUnique } = await import('../engine/src/registry.mjs');
const { imageSize } = await import('../engine/src/imagesize.mjs');
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
  assert.equal(typeof e.persona.name, 'string');
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

test('imagesize: png header', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAADklEQVQIW2NkYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
  assert.deepEqual(imageSize(png), { w: 2, h: 3 });
});
