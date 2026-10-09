// Spawns the MCP server over stdio, performs the handshake, lists tools, opens
// the graph unique, hits the HTTP host, posts a window event and reads it back
// through `listen`. Usage: node tests/mcp-smoke.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proc = spawn(process.execPath, [path.join(root, 'engine', 'bin', 'lets-mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LETS_DEBUG: '', LETS_NO_DEFAULTS: '1', LETS_UNIQUES_DIRS: path.join(root, 'tests', 'fixtures', 'uniques') } });
proc.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
let buf = '';
const pending = new Map();
proc.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => { pending.set(id, resolve); setTimeout(() => reject(new Error(`timeout ${method}`)), 20000); });
}
const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); if (r.error) throw new Error(JSON.stringify(r.error)); return JSON.parse(r.result.content[0].text); };
const assert = (cond, msg) => { if (!cond) { console.error('FAIL', msg); process.exitCode = 1; } else console.log('ok  ', msg); };

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  assert(init.result?.serverInfo?.name === 'lets', 'initialize');
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await rpc('tools/list');
  const names = tools.result.tools.map((t) => t.name);
  assert(['open', 'listen', 'send', 'say', 'query', 'state', 'uniques', 'store', 'entity', 'plan'].every((n) => names.includes(n)), `tools/list: ${names.join(',')}`);

  const opened = await call('open', { unique: 'mini' });
  assert(opened.url?.startsWith('http://127.0.0.1:'), `open → ${opened.url}`);
  assert(typeof opened.guide === 'string', 'open returns guide');
  assert(opened.entity?.persona?.name, `entity brief: ${opened.entity?.persona?.name}`);
  const u = new URL(opened.url);
  const hash = new URLSearchParams(u.hash.slice(1));
  const token = hash.get('t'); const w = hash.get('w');

  const health = await (await fetch(`${u.origin}/health`)).json();
  assert(health.ok, 'GET /health');
  const page = await fetch(`${u.origin}/u/mini/`);
  assert(page.status === 200 && (page.headers.get('content-type') || '').includes('text/html'), `GET /u/mini/ → ${page.status}`);
  const sdk = await fetch(`${u.origin}/sdk/lets-client.js`);
  assert(sdk.status === 200, 'GET /sdk/lets-client.js');
  const unauth = await fetch(`${u.origin}/lip/drain`);
  assert(unauth.status === 401, 'drain without token → 401');
  const traversal = await fetch(`${u.origin}/u/mini/../../package.json`);
  assert(traversal.status !== 200 || !(await traversal.text()).includes('"name": "lets"'), 'path traversal blocked');

  // simulate a window: SSE connect, then post an event
  const ctl = new AbortController();
  const sse = await fetch(`${u.origin}/lip/stream?w=${w}&u=mini&t=${token}`, { signal: ctl.signal });
  assert(sse.status === 200, 'SSE stream connects');
  const reader = sse.body.getReader();
  const firstChunk = new TextDecoder().decode((await reader.read()).value);
  assert(firstChunk.includes('lip.hello') || firstChunk.includes('connected'), 'SSE hello');

  const ev = { lip: 1, id: 'ev_TESTTESTTESTTEST', ts: Date.now(), dir: 'up', from: `unique:mini#${w}`, type: 'mini.ping', data: { graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] } } };
  const post = await fetch(`${u.origin}/lip/event?w=${w}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lets-token': token }, body: JSON.stringify(ev) });
  assert(post.status === 202, 'POST /lip/event → 202');
  const listened = await call('listen', { wait_ms: 2000, types: ['mini.*'] });
  assert(listened.events.some((e) => e.t === 'mini.ping'), `listen sees mini.ping (${listened.events.map((e) => e.t).join(',')})`);

  // send a command and see it on the SSE stream
  const sent = await call('send', { commands: [{ type: 'entity.say', data: { ids: ['a'] } }] });
  assert(sent.results[0].delivered.includes(w), 'send delivered to window');
  let got = '';
  for (let i = 0; i < 5 && !got.includes('entity.say'); i++) got += new TextDecoder().decode((await reader.read()).value);
  assert(got.includes('entity.say'), 'SSE carries the command');

  // query round-trip: answer graph.snapshot from the fake window
  const qp = call('query', { type: 'mini.snapshot', timeout_ms: 5000 });
  await new Promise((r) => setTimeout(r, 200));
  await fetch(`${u.origin}/lip/event?w=${w}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lets-token': token }, body: JSON.stringify({ ...ev, id: 'ev_TESTTESTTESTTES2', type: 'mini.snapshot' }) });
  const q = await qp;
  assert(q.reply?.t === 'mini.snapshot', 'query gets its reply');

  // upload
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAADklEQVQIW2NkYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');
  const up = await (await fetch(`${u.origin}/lip/upload?w=${w}&source=paste`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-lets-token': token }, body: png })).json();
  assert(up.path?.endsWith('.png') && up.w === 2 && up.h === 3, `upload stored ${up.path} ${up.w}x${up.h}`);
  const media = await call('listen', { wait_ms: 1000, types: ['media.*'] });
  assert(media.events.some((e) => e.t === 'media.image'), 'media.image event emitted');

  // entity + plan + store (offline parts)
  const taught = await call('entity', { action: 'teach', name: 'smoke skill', triggers: ['smoke'], body: '## When\ntesting\n## Steps\n1. nothing' });
  assert(taught.name === 'smoke-skill', 'entity teach');
  const skills = await call('entity', { action: 'skills' });
  assert(skills.some((s) => s.name === 'smoke-skill'), 'entity skills lists it');
  await call('entity', { action: 'forget', name: 'smoke skill' });
  const plan = await call('plan', { tasks: [{ id: 'a', title: 'fmt', kind: 'format', size: 's' }, { id: 'b', title: 'arch', kind: 'architecture', size: 'l', depends: ['a'] }] });
  assert(plan.plan.waves.length === 2 && plan.plan.tasks.a.model === 'haiku' && plan.plan.tasks.b.model === 'opus', `plan routes: ${JSON.stringify(plan.plan.waves)} a=${plan.plan.tasks.a.model} b=${plan.plan.tasks.b.model}`);
  const stores = await call('store', { action: 'stores' });
  assert(Array.isArray(stores) && stores.length, 'store list');
  ctl.abort();
} catch (err) {
  console.error('FAIL', err);
  process.exitCode = 1;
} finally {
  proc.stdin.end();
  setTimeout(() => proc.kill(), 500);
}
