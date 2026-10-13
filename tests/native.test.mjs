// Native windows (docs/NATIVE.md): the registry's `native` block, the vm
// runtime and its shell, the host endpoints the lets-native mod polls, the
// `open` tool in native mode, and the handoff / resume path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.LETS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-native-'));
process.env.LETS_NO_DEFAULTS = '1';

const { validate } = await import('../engine/src/validate.mjs');
const { Bus } = await import('../engine/src/bus.mjs');
const { inspectUnique, Registry } = await import('../engine/src/registry.mjs');
const { NativeRuntime, sanitizeTree, dumpTree, ELEMENT_PROPS } = await import('../engine/src/native.mjs');
const { PLUGIN_ROOT } = await import('../engine/src/paths.mjs');

const FIXTURES = path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'uniques');
const MINI = path.join(FIXTURES, 'mini');
const schema = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'protocol/schemas/unique.schema.json'), 'utf8'));

/** Every node of a tree, flattened, for assertions. */
function* walk(node) {
  if (node == null || typeof node !== 'object') return;
  yield node;
  for (const c of node.c || []) yield* walk(c);
}
const findKey = (tree, key) => [...walk(tree)].find((n) => n.p?.key === key) || null;
const textOf = (tree) => dumpTree(tree);

function makeRuntime() {
  const prev = process.env.LETS_UNIQUES_DIRS;
  process.env.LETS_UNIQUES_DIRS = FIXTURES;
  const registry = new Registry();
  if (prev === undefined) delete process.env.LETS_UNIQUES_DIRS; else process.env.LETS_UNIQUES_DIRS = prev;
  const bus = new Bus();
  const logs = [];
  const runtime = new NativeRuntime({ bus, registry, entity: { personaForShell: () => ({ name: 'Doto', traits: {}, color: '#a66bff' }) }, log: (s, m) => logs.push(`[${s}] ${m}`) });
  return { bus, registry, runtime, logs };
}

test('schema + registry: a native block is accepted; entry xor native; escaping native.entry is rejected', () => {
  const base = { lip: 1, name: 'xy', version: '0.1.0', title: 'x', domains: ['xy'] };
  assert.equal(validate(schema, { ...base, entry: 'ui/index.html' }).ok, true);
  assert.equal(validate(schema, { ...base, native: { entry: 'native/index.js' } }).ok, true);
  assert.equal(validate(schema, { ...base, native: { entry: 'native/index.js', title: 't', columns: 50, rows: 30 } }).ok, true);
  assert.equal(validate(schema, base).ok, false, 'neither entry nor native');
  assert.equal(validate(schema, { ...base, native: { entry: 'native/index.html' } }).ok, false, 'native.entry must be a script');
  assert.equal(validate(schema, { ...base, native: { entry: 'native/index.js', bogus: 1 } }).ok, false);
  assert.equal(validate(schema, { ...base, native: { entry: 'native/index.js', columns: 5 } }).ok, false);

  const mini = inspectUnique(MINI);
  assert.equal(mini.ok, true, mini.problems.join('; '));
  assert.deepEqual(mini.modes, ['web', 'native']);
  assert.ok(mini.nativeEntry.endsWith(path.join('native', 'index.js')));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-nu-'));
  fs.mkdirSync(path.join(dir, 'native'));
  fs.writeFileSync(path.join(dir, 'native', 'index.js'), 'lets.native({ init() { return {}; }, render(s, ui) { return ui.text("only native"); } });');
  fs.writeFileSync(path.join(dir, 'unique.json'), JSON.stringify({ lip: 1, name: 'onlynative', version: '0.0.1', title: 'n', native: { entry: 'native/index.js' }, domains: ['onlynative'] }));
  const only = inspectUnique(dir);
  assert.equal(only.ok, true, only.problems.join('; '));
  assert.deepEqual(only.modes, ['native']);
  assert.equal(only.entry, null);
  fs.writeFileSync(path.join(dir, 'unique.json'), JSON.stringify({ lip: 1, name: 'onlynative', version: '0.0.1', title: 'n', native: { entry: '../x.js' }, domains: ['onlynative'] }));
  const bad = inspectUnique(dir);
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => /native.entry/.test(p)), bad.problems.join('; '));
  fs.writeFileSync(path.join(dir, 'unique.json'), JSON.stringify({ lip: 1, name: 'onlynative', version: '0.0.1', title: 'n', native: { entry: 'native/missing.js' }, domains: ['onlynative'] }));
  assert.ok(inspectUnique(dir).problems.some((p) => /not found/.test(p)));
});

test('sanitizeTree: whitelist, key prefix, children rules, svg scrub, bounds; dumpTree', () => {
  const t = sanitizeTree({ t: 'Box', p: { gap: 1, onPress: 'x', flexDirection: 'column' }, c: [
    { t: 'Button', p: { key: 'go', label: 'Go', hotkey: 'g' } },
    { t: 'Button', p: { label: 'NoKey' } },
    { t: 'Input', p: { label: 'no key' } },
    { t: 'Select', p: { key: 'k', options: [{ value: 'a' }, { value: 'a', label: 'dup' }, { value: 'b', label: 'B' }, 5] } },
    { t: 'Select', p: { key: 'empty', options: [] } },
    { t: 'Svg', p: { source: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', alt: 'bad' } },
    { t: 'Svg', p: { source: 'not svg', alt: 'nope' } },
    { t: 'Svg', p: { source: '<svg viewBox="0 0 1 1"><rect onclick="x"/></svg>', alt: 'handler' } },
    { t: 'Svg', p: { source: '<svg viewBox="0 0 1 1"><rect/></svg>', alt: 'good', width: 10, height: '20' } },
    { t: 'Text', p: { color: 'red', bogus: 1 }, c: ['a\u0007b', { t: 'Box', p: {}, c: [] }, { t: 'Text', p: {}, c: ['nested'] }] },
    { t: 'Nope', p: { alt: 'unknown' } },
    { t: 'Link', p: { label: 'no href' } },
    'plain', 7, null, false,
  ] });
  assert.equal(t.t, 'Box');
  assert.deepEqual(Object.keys(t.p).sort(), ['flexDirection', 'gap'], 'onPress is not a Box prop');
  const go = findKey(t, 'u.go');
  assert.ok(go && go.t === 'Button' && go.p.label === 'Go' && !('hotkey' in go.p));
  assert.ok(findKey(t, 'u.NoKey'), 'a Button without key is addressed by its label');
  assert.equal(t.c[2].t, 'Text', 'an Input without a key becomes text');
  const sel = findKey(t, 'u.k');
  assert.deepEqual(sel.p.options, [{ value: 'a' }, { value: 'b', label: 'B' }]);
  assert.equal(t.c[4].t, 'Text', 'an empty Select becomes text');
  assert.equal(t.c[5].t, 'Text', 'script in svg → alt text');
  assert.equal(t.c[6].t, 'Text', 'not an svg → alt text');
  assert.equal(t.c[7].t, 'Text', 'event handler attribute → alt text');
  assert.equal(t.c[8].t, 'Svg');
  assert.equal(t.c[8].p.width, 10);
  assert.equal('height' in t.c[8].p, false, 'a string height is dropped');
  const text = t.c[9];
  assert.deepEqual(text.p, { color: 'red' });
  assert.deepEqual(text.c, ['ab', { t: 'Text', p: {}, c: ['nested'] }], 'control char stripped; a Box inside Text dropped');
  assert.equal(t.c[10].t, 'Text');
  assert.equal(t.c[11].t, 'Text', 'a Link without href is text');
  assert.equal(t.c[12], 'plain');
  assert.equal(t.c[13], '7');
  assert.equal(t.c.length, 14);
  // bounds
  let deep = { t: 'Box', p: {}, c: [] };
  for (let i = 0; i < 30; i++) deep = { t: 'Box', p: {}, c: [deep] };
  assert.throws(() => sanitizeTree(deep), /deeper/);
  assert.throws(() => sanitizeTree({ t: 'Box', p: {}, c: Array.from({ length: 5001 }, () => ({ t: 'Text', p: {}, c: ['x'] })) }), /more than/);
  assert.equal(sanitizeTree(null), null);
  const dump = dumpTree(t);
  assert.match(dump, /\[Go\]  \(u\.go\)/);
  assert.match(dump, /\{svg 10x\? good/);
  assert.match(dump, /no href/);
  for (const k of Object.keys(ELEMENT_PROPS)) assert.ok(Array.isArray(ELEMENT_PROPS[k]));
});

test('runtime: open, render (shell + view), actions, commands, replies, acks, errors, timeout, close', async () => {
  const { bus, runtime, logs } = makeRuntime();
  const events = () => bus.read('t', { max: 200 }).events;
  const opened = runtime.open('mini', { args: { intent: 'test it' } });
  assert.match(opened.windowId, /^[A-Z0-9]+$/);
  assert.equal(opened.title, 'mini (native)');
  assert.equal(opened.columns, 40);
  const w = opened.windowId;
  const first = events().map((e) => e.type);
  assert.deepEqual(first, ['session.opened', 'lip.ready']);
  assert.equal(bus.windowList()[0].mode, 'native');
  assert.equal(bus.windowList()[0].connected, true);
  assert.equal(bus.windowList()[0].ready, true);

  // the first sync draws the shell around the view
  let s = runtime.sync({ cols: 60, rows: 30, modVersion: 'test' });
  assert.equal(runtime.modSeen, true);
  assert.equal(s.windows.length, 1);
  let tree = s.windows[0].tree;
  assert.ok(tree, 'a tree the mod does not know yet');
  let text = textOf(tree);
  assert.match(text, /◉ Doto/);
  assert.match(text, /\[Send to Claude\]  \(s\.send\)/, 'export() → the shell draws Send to Claude');
  assert.match(text, /intent: test it/);
  assert.match(text, /60x30/, 'ctx.viewport follows the sync');
  assert.match(text, /\[ping \(0\)\]  \(u\.ping\)/);
  assert.match(text, /\{svg 40x40 0 pings/);
  assert.match(text, /\*\*bold\*\*/);
  assert.match(text, /```json/);
  assert.match(text, /example <https:\/\/example.com>/);
  assert.match(text, /an unknown element/, 'an unknown element draws as its alt');
  const rev1 = s.windows[0].rev;
  s = runtime.sync({ known: { [w]: rev1 }, cols: 60, rows: 30 });
  assert.equal(s.windows[0].tree, undefined, 'no tree when the mod knows the rev');

  // actions: a press, an Enter, a pick, a throw, a forbidden emit
  let r = runtime.action(w, { key: 'u.ping', kind: 'press' });
  assert.equal(r.ok, true);
  assert.ok(r.rev > rev1);
  assert.match(textOf(r.tree), /\[ping \(1\)\]/);
  assert.deepEqual(events().map((e) => [e.type, e.data.n]), [['mini.ping', 1]]);
  r = runtime.action(w, { key: 'u.note', kind: 'submit', value: 'hello\u0007 there' });
  assert.match(textOf(r.tree), /<note: hello there>/);
  r = runtime.action(w, { key: 'u.kind', kind: 'select', value: 'b' });
  assert.match(textOf(r.tree), /\(kind: b ▾ a\|b\)/);
  r = runtime.action(w, { key: 'u.boom', kind: 'press' });
  assert.equal(r.ok, false);
  assert.match(r.error, /boom pressed/);
  assert.match(textOf(r.tree), /› .*boom pressed/, 'the error is shown as a toast');
  r = runtime.action(w, { key: 'u.other', kind: 'press' });
  assert.equal(r.ok, true);
  assert.equal(events().length, 0, 'an emit outside the unique domains is dropped');
  assert.ok(logs.some((l) => /dropped emit of "entity.secret"/.test(l)));
  r = runtime.action(w, { key: 'nonsense', kind: 'press' });
  assert.equal(r.ok, false);
  assert.equal(runtime.action('W_NOPE', { key: 'u.ping' }).ok, false);

  // commands through the bus: a view handler, a reply with `re`, an ack, an error, a shell command
  bus.send({ type: 'mini.add', data: { item: 'first' } }, w);
  bus.send({ type: 'mini.add', data: { item: 'second' } }, w);
  const q = bus.send({ type: 'mini.snapshot', data: {} }, w);
  let ev = events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'mini.snapshot');
  assert.equal(ev[0].re, q.id, 'ctx.reply sets re to the command id');
  assert.deepEqual(ev[0].data.items, ['first', 'second']);
  assert.equal(ev[0].data.note, 'hello there');
  const acked = bus.send({ type: 'mini.add', data: { item: 'third' }, ack: true }, w);
  const failed = bus.send({ type: 'mini.fail', data: {}, ack: true }, w);
  bus.send({ type: 'mini.nothing', data: {} }, w);
  ev = events();
  assert.deepEqual(ev.map((e) => e.type), ['lip.ack', 'lip.ack', 'lip.error']);
  assert.deepEqual([ev[0].re, ev[0].data], [acked.id, { ok: true }]);
  assert.deepEqual([ev[1].re, ev[1].data.ok], [failed.id, false]);
  assert.match(ev[1].data.error, /nope/);
  assert.match(ev[2].data.message, /no handler for mini.nothing/);
  bus.send({ type: 'mini.log', data: {} }, w);
  assert.ok(logs.some((l) => /a log line \{"ok":true\}/.test(l)) && logs.some((l) => /warn: careful/.test(l)));
  bus.send({ type: 'mini.replace', data: {} }, w);
  tree = runtime.sync({}).windows[0].tree;
  assert.match(textOf(tree), /\[ping \(100\)\]/, 'a handler may return a new state');
  bus.send({ type: 'mini.toast', data: { text: 'from the view', level: 'ok' } }, w);
  assert.match(textOf(runtime.sync({}).windows[0].tree), /› from the view/);

  // limits: a handler that never returns, a state over 1 MB
  const t0 = Date.now();
  bus.send({ type: 'mini.spin', data: {}, ack: true }, w);
  ev = events();
  assert.equal(ev[0].type, 'lip.ack');
  assert.equal(ev[0].data.ok, false);
  assert.match(ev[0].data.error, /longer than 2000 ms/);
  assert.ok(Date.now() - t0 < 4000);
  bus.send({ type: 'mini.huge', data: {}, ack: true }, w);
  assert.match(events()[0].data.error, /state over/);
  assert.match(textOf(runtime.sync({}).windows[0].tree), /\[ping \(100\)\]/, 'the view still renders after a stopped handler');

  // shell commands: companion, chat, components, toasts
  bus.send({ type: 'entity.say', data: { text: 'Added *x*. Next?', mood: 'proud' } }, w);
  bus.send({ type: 'entity.react', data: { name: 'wink' } }, w);
  bus.send({ type: 'entity.suggest', data: { items: [{ id: 'c-1', label: 'Add retry' }, { id: 'c-2', label: 'Explain' }] } }, w);
  text = textOf(runtime.sync({}).windows[0].tree);
  assert.match(text, /◉★ Doto/);
  assert.match(text, /· proud/);
  assert.match(text, /Doto: Added \*x\*\. Next\?/);
  assert.match(text, /\[Add retry\]  \(s\.pick:c-1\)/);
  r = runtime.action(w, { key: 's.pick:c-1', kind: 'press' });
  assert.deepEqual(events().map((e) => [e.type, e.data]), [['entity.pick', { id: 'c-1', label: 'Add retry' }]]);
  assert.doesNotMatch(textOf(r.tree), /Add retry/);
  assert.match(textOf(r.tree), /\[Explain\]/);
  bus.send({ type: 'entity.mood', data: { mood: 'bogus' }, ack: true }, w);
  assert.match(events()[0].data.error, /unknown mood/);
  bus.send({ type: 'entity.react', data: { name: 'bogus' }, ack: true }, w);
  assert.match(events()[0].data.error, /unknown reaction/);
  bus.send({ type: 'entity.persona', data: { name: 'Nova', color: '#6bf0ff' } }, w);
  assert.match(textOf(runtime.sync({}).windows[0].tree), /◉★ Nova/);

  bus.send({ type: 'chat.say', data: { text: 'Hello ' }, re: 'st1', done: false }, w);
  bus.send({ type: 'chat.say', data: { text: 'there.', done: true }, re: 'st1' }, w);
  bus.send({ type: 'chat.say', data: { text: 'A second line' } }, w);
  text = textOf(runtime.sync({}).windows[0].tree);
  assert.match(text, /Nova: Hello there\./, 'chunks of one stream join');
  assert.match(text, /Nova: A second line/);
  assert.match(text, /<…Message Nova…>  \(s\.chat\)/, 'chat.say opens the chat with its input');
  r = runtime.action(w, { key: 's.chat', kind: 'submit', value: 'hi back' });
  assert.deepEqual(events().map((e) => [e.type, e.data]), [['chat.message', { text: 'hi back' }]]);
  assert.match(textOf(r.tree), /you: hi back/);
  r = runtime.action(w, { key: 's.chat.toggle', kind: 'press' });
  assert.doesNotMatch(textOf(r.tree), /\(s\.chat\)/, 'chat closed');

  bus.send({ type: 'component.create', data: { id: 'pick', type: 'options', props: { title: 'Which?', items: [{ id: 'tree', label: 'Tree' }, { id: 'radial', label: 'Radial' }] } } }, w);
  bus.send({ type: 'component.create', data: { id: 'tog', type: 'toggle', props: { label: 'dark', value: false } } }, w);
  bus.send({ type: 'component.create', data: { id: 'p', type: 'progress', props: { value: 0.5, label: 'half' } } }, w);
  bus.send({ type: 'component.create', data: { id: 'f', type: 'form', props: { fields: [{ id: 'name', label: 'Name' }, { id: 'size', type: 'select', options: ['s', 'm'] }], submit: 'Go' } } }, w);
  bus.send({ type: 'component.create', data: { id: 'sl', type: 'slider', props: { min: 0, max: 10, value: 5 } } }, w);
  bus.send({ type: 'component.create', data: { id: 'x', type: 'whatever', props: { a: 1 } } }, w);
  text = textOf(runtime.sync({}).windows[0].tree);
  assert.match(text, /Which\?/);
  assert.match(text, /\[Tree\]  \(s\.comp:pick:pick:tree\)/);
  assert.match(text, /\[○ off\]  \(s\.comp:tog:toggle\)/);
  assert.match(text, /50% half/);
  assert.match(text, /<Name: >  \(s\.comp:f:field:name\)/);
  assert.match(text, /\(size: s ▾ s\|m\)  \(s\.comp:f:field:size\)/);
  assert.match(text, /"a": 1/, 'an unknown type shows its props');
  runtime.action(w, { key: 's.comp:pick:pick:tree', kind: 'press' });
  runtime.action(w, { key: 's.comp:tog:toggle', kind: 'press' });
  runtime.action(w, { key: 's.comp:f:field:name', kind: 'submit', value: 'Doto' });
  runtime.action(w, { key: 's.comp:f:field:size', kind: 'select', value: 'm' });
  runtime.action(w, { key: 's.comp:f:submit', kind: 'press' });
  runtime.action(w, { key: 's.comp:sl:slide', kind: 'submit', value: '12' });
  r = runtime.action(w, { key: 's.comp:pick:close', kind: 'press' });
  assert.deepEqual(events().map((e) => [e.data.id, e.data.action, e.data.value]), [
    ['pick', 'pick', 'tree'], ['tog', 'change', true], ['f', 'submit', { name: 'Doto', size: 'm' }], ['sl', 'change', 10], ['pick', 'close', undefined],
  ]);
  assert.doesNotMatch(textOf(r.tree), /Which\?/);
  bus.send({ type: 'component.update', data: { id: 'p', props: { value: 1 } } }, w);
  bus.send({ type: 'component.remove', data: { id: 'tog' } }, w);
  bus.send({ type: 'component.update', data: { id: 'gone', props: {} }, ack: true }, w);
  text = textOf(runtime.sync({}).windows[0].tree);
  assert.match(text, /100% half/);
  assert.doesNotMatch(text, /dark/);
  assert.match(events()[0].data.error, /no component "gone"/);
  bus.send({ type: 'ui.toast', data: { text: 'one' } }, w);
  bus.send({ type: 'ui.toast', data: { text: 'two', level: 'warn' } }, w);
  bus.send({ type: 'ui.toast', data: { text: 'three' } }, w);
  bus.send({ type: 'ui.toast', data: { text: 'four', level: 'error' } }, w);
  text = textOf(runtime.sync({}).windows[0].tree);
  assert.doesNotMatch(text, /› one/, 'three toasts at most');
  assert.match(text, /› four/);
  bus.send({ type: 'session.listening', data: { on: true } }, w);
  assert.match(textOf(runtime.sync({}).windows[0].tree), /· listening/);

  // close by the person: the context goes, session.closed is pushed now, the profile too
  const closed = runtime.close(w, 'person');
  assert.deepEqual(closed, { ok: true, closed: true });
  ev = events();
  assert.deepEqual(ev.map((e) => e.type), ['mini.ping', 'entity.profile', 'session.closed']);
  assert.equal(ev[0].data.bye, true, 'destroy() may still emit');
  assert.equal(ev[1].data.native, true);
  assert.ok(ev[1].data.picks >= 1);
  assert.deepEqual(ev[2].data, { windowId: w, unique: 'mini', mode: 'native' });
  assert.equal(bus.windowList().length, 0);
  assert.equal(runtime.action(w, { key: 'u.ping' }).ok, false);
  s = runtime.sync({ known: { [w]: 1 } });
  assert.equal(s.windows[0].closed, true, 'the mod sees the close once');
  assert.equal(runtime.sync({}).windows.length, 0, 'then the window is forgotten');
  assert.equal(runtime.close(w).ok, false);
  assert.throws(() => runtime.open('nope'), /unknown or invalid/);
});

test('runtime: the limits a view cannot cross (review findings): closed windows are forgotten, async handlers, the emit queue, big exports, svg scrubbing, toasts, streams', () => {
  const { bus, runtime, logs } = makeRuntime();
  const events = () => bus.read('t', { max: 500 }).events;
  const { windowId: w } = runtime.open('mini');
  events();
  // an async handler is refused and what it did before its first await is undone; a throwing one too
  bus.send({ type: 'mini.async', data: {}, ack: true }, w);
  assert.match(events()[0].data.error, /synchronous/);
  assert.match(textOf(runtime.sync({}).windows[0].tree), /\[ping \(0\)\]/, 'the state is as it was');
  bus.send({ type: 'mini.add', data: { item: 'kept' } }, w);
  bus.send({ type: 'mini.halfway', data: {}, ack: true }, w);
  assert.match(events()[0].data.error, /halfway/);
  assert.match(textOf(runtime.sync({}).windows[0].tree), /1\. kept\n/, 'a handler that throws after mutating is rolled back');
  assert.doesNotMatch(textOf(runtime.sync({}).windows[0].tree), /halfway/);
  // a view may raise lip.error (with re), echo a line into the chat, and ask for a redraw later
  const bad = bus.send({ type: 'mini.partial', data: {} }, w);
  const errs = events();
  assert.deepEqual(errs.map((e) => e.type), ['lip.error']);
  assert.equal(errs[0].re, bad.id);
  assert.deepEqual(errs[0].data, { code: 'partial', message: 'skipped 2' });
  bus.send({ type: 'mini.echo', data: { text: 'why?' } }, w);
  assert.match(textOf(runtime.sync({}).windows[0].tree), /you: why\?/);
  // ctx.after: the rev moves on its own after the delay, so an expiring highlight redraws
  const before = runtime.get(w).rev;
  bus.send({ type: 'mini.later', data: { ms: 100 } }, w);
  const afterSend = runtime.get(w).rev;
  return new Promise((resolve) => setTimeout(resolve, 180)).then(() => {
    assert.ok(runtime.get(w).rev > afterSend && afterSend > before, 'a redraw happened later');
    // graph.changed-style events from a native window are never coalesced away
    bus.send({ type: 'mini.changed', data: { n: 1 } }, w);
    bus.send({ type: 'mini.changed', data: { n: 2 } }, w);
    assert.deepEqual(events().map((e) => e.data.n), [1, 2]);
    limitsRest(bus, runtime, logs, w, events);
  });
});

function limitsRest(bus, runtime, logs, w, events) {
  // svg text is not scanned: a label may say "data: users"
  assert.equal(sanitizeTree({ t: 'Svg', p: { source: '<svg xmlns="http://www.w3.org/2000/svg"><text>data: users (x) version=2 @home</text></svg>', alt: 'ok' } }).t, 'Svg');
  assert.equal(sanitizeTree({ t: 'Svg', p: { source: '<svg><style>rect{fill:url("https://x")}</style><text>data: users</text></svg>', alt: 'x' } }).t, 'Text', 'with a <style> everything is scanned');
  // 5000 emits in one handler: at most 1000 reach the bus, the rest are counted and logged; one big reply (300 KB) passes
  bus.send({ type: 'mini.big', data: {} }, w);
  assert.equal(events()[0].data.blob.length, 300000);
  bus.send({ type: 'mini.flood', data: {} }, w);
  const flood = events().filter((e) => e.type === 'mini.ping').length;
  assert.ok(flood > 0 && flood <= 1000, `flood delivered ${flood}`);
  assert.ok(logs.some((l) => /dropped \d+ queued item/.test(l)), 'the drop is logged');
  // an export over 1 MB is refused before it reaches the bus
  bus.send({ type: 'mini.bigexport', data: {} }, w);
  const r = runtime.action(w, { key: 's.send', kind: 'press' });
  assert.equal(r.ok, false);
  assert.match(r.error, /result over/);
  assert.equal(events().some((e) => e.type === 'mini.export'), false);
  // a Button with a child and no label gets the child's text as its label
  assert.match(textOf(runtime.sync({}).windows[0].tree), /\[from a child\]  \(u\.kid\)/);
  // per-window viewports
  const { windowId: w2 } = runtime.open('mini');
  const s = runtime.sync({ viewports: { [w]: { cols: 80, rows: 10 }, [w2]: { cols: 30, rows: 50 } } });
  assert.match(textOf(s.windows.find((x) => x.id === w).tree), /80x10/);
  assert.match(textOf(s.windows.find((x) => x.id === w2).tree), /30x50/);
  // toasts fade after a while, without a command
  bus.send({ type: 'ui.toast', data: { text: 'ephemeral' } }, w);
  assert.match(textOf(runtime.sync({}).windows.find((x) => x.id === w).tree), /› ephemeral/);
  for (const t of runtime.get(w).shell.toasts) t.at -= 10_000;
  assert.doesNotMatch(textOf(runtime.sync({}).windows.find((x) => x.id === w).tree), /› ephemeral/);
  // abandoned chat streams are capped
  for (let i = 0; i < 40; i++) bus.send({ type: 'chat.say', data: { text: `s${i}`, done: false }, re: `st${i}` }, w);
  assert.ok(runtime.get(w).shell.chat.streams.size <= 16);
  // a closed window is listed to the poller until it has seen the close (or 10 s), then forgotten
  runtime.close(w2, 'person');
  assert.equal(runtime.sync({}).windows.find((x) => x.id === w2)?.closed, true, 'listed once more without known');
  assert.equal(runtime.sync({}).windows.find((x) => x.id === w2)?.closed, true, 'still listed: the poller never acknowledged');
  runtime.get(w2).closedAt -= 20_000;
  runtime.sync({});
  assert.equal(runtime.sync({}).windows.some((x) => x.id === w2), false, 'dropped after the grace period');
  runtime.close(w, 'person');
  runtime.sync({ known: { [w]: 1 } });
  assert.equal(runtime.windows.size, 0, 'dropped as soon as the poller has seen the close');
  assert.equal(events().some((e) => e.type === 'entity.profile' && e.data.native === true), true, 'the profile is sent at close');
  // what the svg scrub refuses
  const { svgProblem } = { svgProblem: (src) => sanitizeTree({ t: 'Svg', p: { source: src, alt: 'pic' } }) };
  const refused = (src) => { const t = svgProblem(src); return t.t === 'Text' ? childText(t) : null; };
  const ok = (src) => svgProblem(src).t === 'Svg';
  assert.ok(ok('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="url(#g)"/><use href="#a"/><image href="data:image/png;base64,AAAA"/></svg>'));
  assert.match(refused('<svg><a xlink:href="&#106;avascript:alert(1)">x</a></svg>'), /character references/);
  assert.match(refused('<svg><text>&#x3C;script&#x3E;</text></svg>'), /character references/);
  assert.match(refused('<svg><use xlink:href="https://evil.example/a.svg#root"/></svg>'), /external reference/);
  assert.match(refused('<svg><image href="https://evil.example/x.png"/></svg>'), /external reference/);
  assert.match(refused('<svg><style>rect{fill:url("https://evil.example/x.png")}</style></svg>'), /url\(\) outside/);
  assert.match(refused('<svg><set attributeName="onclick" to="alert(1)"/></svg>'), /animated event handler/);
  assert.match(refused('<svg><a href="javascript:alert(1)">x</a></svg>'), /script or data URL/);
  assert.match(refused('<svg><a href=javascript:alert(1)>x</a></svg>'), /script or data URL/);
  assert.match(refused('<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>'), /not an <svg>/);
  assert.match(refused('<svg><!DOCTYPE svg><rect/></svg>'), /doctype/);
  assert.match(refused('<svg><foreignObject/></svg>'), /script or foreign/);
  assert.match(refused('<svg><rect onclick="x"/></svg>'), /event handler attribute/);
  assert.match(refused('<svg><style>@import url(#x)</style></svg>'), /css import/);
  assert.match(refused('<svg>&amp;<image href="data:text/html,hi"/></svg>'), /script or data URL/);
}

function childText(node) { return (node?.c || []).map((c) => (typeof c === 'string' ? c : childText(c))).join(''); }

test('runtime: a view that fails to load, and one that renders badly, are reported not fatal', () => {
  const { runtime, registry, bus, logs } = makeRuntime();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lets-nv-'));   // its own parent: the registry scans every folder in it
  const dir = path.join(parent, 'badview');
  const write = (src) => { fs.mkdirSync(path.join(dir, 'native'), { recursive: true }); fs.writeFileSync(path.join(dir, 'native', 'index.js'), src); fs.writeFileSync(path.join(dir, 'unique.json'), JSON.stringify({ lip: 1, name: 'badview', version: '0.0.1', title: 'b', native: { entry: 'native/index.js' }, domains: ['badview'] })); };
  write('var x = 1;');
  registry.sources.push({ kind: 'extra', dir: parent });
  registry.refresh();
  assert.throws(() => runtime.open('badview'), /did not call lets.native/);
  write('lets.native({ init() { throw new Error("init broke"); }, render() {} });');
  assert.throws(() => runtime.open('badview'), /init broke/);
  write('lets.native({ init() { return { n: 0 }; }, render(s, ui) { if (s.n) throw new Error("render broke"); return ui.text("fine"); }, on: { "badview.n"(s) { s.n = 1; } } });');
  const { windowId: w } = runtime.open('badview');
  assert.match(textOf(runtime.sync({}).windows[0].tree), /fine/);
  bus.send({ type: 'badview.n', data: {} }, w);
  const text = textOf(runtime.sync({}).windows[0].tree);
  assert.match(text, /view error: .*render broke/);
  assert.match(text, /◉ Doto/, 'the shell still draws');
  assert.ok(logs.some((l) => /render broke/.test(l)));
  write('lets.native({ init() { return {}; }, render(s, ui) { return ui.col({}, Array.from({ length: 3000 }, function (_, i) { return ui.text("line " + i + " " + "x".repeat(40)); })); } });');
  const { windowId: w2 } = runtime.open('badview');
  assert.match(textOf(runtime.sync({}).windows.find((x) => x.id === w2).tree), /view error: tree is \d+ characters/);
  write('lets.native({ init() { return {}; }, render(s, ui) { return ui.text(s.unique); } }); lets.native({ init() {}, render() {} });');
  assert.throws(() => runtime.open('badview'), /called twice/);
});

test('host + tools: /lip/native endpoints, open {mode:"native"}, handoff (export → close → stay) and resume', async () => {
  const prev = process.env.LETS_UNIQUES_DIRS;
  process.env.LETS_UNIQUES_DIRS = FIXTURES;
  const { createEngine } = await import('../engine/src/engine.mjs');
  const engine = await createEngine({ log: () => {} });
  if (prev === undefined) delete process.env.LETS_UNIQUES_DIRS; else process.env.LETS_UNIQUES_DIRS = prev;
  const { host, bus, tools } = engine;
  const tool = (name) => tools.find((t) => t.name === name);
  const hdr = { 'content-type': 'application/json', 'x-lets-token': host.token };
  const get = async (p, h = {}) => (await fetch(`${host.origin}${p}`, { headers: { ...hdr, ...h } })).json();
  const post = async (p, body) => (await fetch(`${host.origin}${p}`, { method: 'POST', headers: hdr, body: JSON.stringify(body) })).json();
  try {
    assert.equal((await fetch(`${host.origin}/lip/native/sync`)).status, 401, 'the token is required');
    const listed = (await tool('uniques').handler({ action: 'list' })).find((u) => u.name === 'mini');
    assert.deepEqual(listed.modes, ['web', 'native']);
    assert.deepEqual((await tool('uniques').handler({ action: 'info', name: 'mini' })).summary.native, { title: 'mini (native)', columns: 40, rows: 20 });

    // the open tool, native mode, before any mod polled
    let opened = await tool('open').handler({ unique: 'mini', mode: 'native', args: { intent: 'x' }, brief: false });
    assert.equal(opened.mode, 'native');
    assert.equal(opened.url, undefined, 'no URL for a native window');
    assert.equal(opened.native.modSeen, false);
    assert.match(opened.native.howToOpen, /plugin install lets-native@lets/);
    assert.deepEqual(opened.modes, ['web', 'native']);
    assert.equal(typeof opened.guide, 'string');
    const w = opened.windowId;
    let st = await tool('state').handler({ what: 'windows' });
    assert.deepEqual(st.map((x) => [x.id, x.mode, x.connected]), [[w, 'native', true]]);
    assert.equal((await tool('state').handler({ what: 'host' })).native.windows, 1);
    const web = await tool('open').handler({ unique: 'mini', brief: false });
    assert.equal(web.mode, 'web');
    assert.match(web.url, /\/u\/mini\/#w=/);
    const noWeb = await tool('open').handler({ unique: 'mini', mode: 'nope', brief: false });
    assert.match(noWeb.error, /no nope window/);

    // the mod's leg: sync (with the header), action, close
    let s = await get(`/lip/native/sync?cols=50&rows=20`, { 'x-lets-native': '0.2.0' });
    assert.equal(s.windows.length, 1);
    assert.equal(s.windows[0].id, w);
    assert.match(dumpTree(s.windows[0].tree), /50x20/);
    assert.equal((await tool('state').handler({ what: 'host' })).native.modSeen, true);
    assert.equal((await tool('state').handler({ what: 'host' })).native.modVersion, '0.2.0');
    assert.equal((await tool('open').handler({ unique: 'mini', mode: 'native', brief: false })).native.modSeen, true);
    s = await get(`/lip/native/sync?known=${w}:${s.windows[0].rev}`);
    assert.equal(s.windows.find((x) => x.id === w).tree, undefined);
    const a = await post(`/lip/native/action?w=${w}`, { key: 'u.ping', kind: 'press' });
    assert.equal(a.ok, true);
    assert.match(dumpTree(a.tree), /\[ping \(1\)\]/);
    const seen = await tool('listen').handler({ types: ['mini.*'] });
    assert.ok(seen.events.some((e) => e.t === 'mini.ping' && e.data.n === 1));
    assert.equal((await post(`/lip/native/action`, {})).error, 'w (window id) required');
    assert.equal((await fetch(`${host.origin}/lip/native/action?w=${w}`, { method: 'POST', headers: hdr, body: '{' })).status, 400);
    assert.equal((await get(`/lip/native/bogus`)).error, 'method', 'a GET on an unknown sub-route is a 405');
    const viaHttp = await post(`/lip/native/open`, { unique: 'mini', windowId: 'W_HTTP' });
    assert.equal(viaHttp.windowId, 'W_HTTP');
    assert.ok((await get(`/lip/native/windows`)).some((x) => x.id === 'W_HTTP'));
    assert.deepEqual(await post(`/lip/native/close?w=W_HTTP`, { reason: 'person' }), { ok: true, closed: true });
    assert.match((await post(`/lip/native/open`, { unique: 'nothing' })).error, /unknown or invalid/);
    assert.equal((await get(`/lip/windows`)).some((x) => x.unique === 'nothing'), false, 'a failed open leaves no ghost window');
    assert.match((await tool('open').handler({ unique: 'nothing', mode: 'native', brief: false })).error, /unknown unique/);
    const odd = await tool('open').handler({ unique: 'mini', mode: 'native', windowId: 'we/ird id!', brief: false });
    assert.equal(odd.windowId, 'weirdid', 'the window id is scrubbed');
    // the mod's per-pane sizes
    const sized = await get(`/lip/native/sync?v=${odd.windowId}:33x9`);
    assert.match(dumpTree(sized.windows.find((x) => x.id === odd.windowId).tree), /33x9/);
    await post(`/lip/native/close?w=${odd.windowId}`, { reason: 'person' });

    // Send to Claude from the pane: saved as a session, marked as a handoff, the window told to close
    await tool('listen').handler({});
    const sent = await post(`/lip/native/action?w=${w}`, { key: 's.send', kind: 'press' });
    assert.equal(sent.ok, true);
    const got = await tool('listen').handler({ types: ['mini.export', 'session.closing'] });
    const exp = got.events.find((e) => e.t === 'mini.export');
    assert.ok(exp, 'the export event');
    assert.equal(exp.data.session.handoff, true);
    assert.equal(exp.data.pings, 1);
    assert.ok(got.events.some((e) => e.t === 'session.closing' && e.data.reason === 'handoff'));
    const sid = exp.data.session.id;
    assert.match(dumpTree(sent.tree), /Sent to Claude/);
    s = await get(`/lip/native/sync`);
    let tree = dumpTree(s.windows.find((x) => x.id === w).tree);
    assert.match(tree, /See you in Claude Code/);
    assert.match(tree, /\[Keep working\]  \(s\.stay\)/);
    assert.doesNotMatch(tree, /\[ping/, 'the view is replaced by the farewell card');
    const stay = await post(`/lip/native/action?w=${w}`, { key: 's.stay', kind: 'press' });
    assert.match(dumpTree(stay.tree), /\[ping \(1\)\]/, 'Keep working brings the view back');
    assert.ok((await tool('listen').handler({ types: ['session.stay'] })).events.length === 1);
    assert.equal(engine.sessions.list({ unique: 'mini' })[0].id, sid);

    // the farewell ends by itself: closed, dropped
    await post(`/lip/native/action?w=${w}`, { key: 's.send', kind: 'press' });
    await new Promise((r) => setTimeout(r, 2800));
    s = await get(`/lip/native/sync?known=${w}:1`);
    assert.equal(s.windows.find((x) => x.id === w)?.closed, true);
    assert.ok((await tool('listen').handler({ types: ['session.closed'] })).events.some((e) => e.data.windowId === w));

    // resume into a new native window: the restore command is the first thing the view handles
    const back = await tool('open').handler({ unique: 'mini', mode: 'native', resume: 'last', brief: false });
    assert.equal(back.resumed.id, sid);
    assert.equal(back.resumed.restore, 'mini.load');
    s = await get(`/lip/native/sync`);
    tree = dumpTree(s.windows.find((x) => x.id === back.windowId).tree);
    assert.match(tree, new RegExp(`resumed session ${sid}`));
    assert.match(tree, /<note: …type a note>/, 'the saved note was empty');
    assert.match(tree, /\[ping \(0\)\]/, 'pings are not part of the restore payload');
    const missing = await tool('open').handler({ unique: 'mini', mode: 'native', resume: 's_NOPE', brief: false });
    assert.match(missing.resumed.error, /no saved session/);
    assert.ok((await tool('send').handler({ commands: [{ type: 'mini.add', data: { item: 'late' } }], to: back.windowId })).results[0].delivered.includes(back.windowId));
    const q = await tool('query').handler({ type: 'mini.snapshot', to: back.windowId });
    assert.deepEqual(q.reply.data.items, ['late']);
    assert.equal((await tool('say').handler({ text: 'hello', via: 'both', mood: 'happy', to: back.windowId })).delivered.length, 4, 'mood + chat.open + chat.say + entity.say');
    tree = dumpTree((await get(`/lip/native/sync`)).windows.find((x) => x.id === back.windowId).tree);
    assert.match(tree, /Doto: hello/);
    assert.match(tree, /· happy/);
  } finally { engine.stop(); }
});
