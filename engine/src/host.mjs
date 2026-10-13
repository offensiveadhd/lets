/**
 * The lets host: a loopback HTTP server that serves uniques and the SDK,
 * carries LIP up-events (POST) and down-commands (SSE), stores uploads, and
 * exposes drain/persona endpoints for hooks and shells.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, PLUGIN_ROOT, writeJson, isInside, ensureDirs } from './paths.mjs';
import { rid, token as mkToken } from './ids.mjs';
import { Bus } from './bus.mjs';
import { Registry } from './registry.mjs';
import { NativeRuntime } from './native.mjs';
import { imageSize } from './imagesize.mjs';
import { execList } from './runner.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_EVENT_BODY = 1024 * 1024;
// ports fetch() and browsers refuse to connect to (the WHATWG fetch "bad ports" list, above 1023)
const BAD_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
const CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";
const redact = (u) => String(u).replace(/([?&#]t=)[^&#\s]+/g, '$1[redacted]');

export class Host {
  constructor({ log = () => {}, projectDir = process.cwd(), entity = null, runner = null } = {}) {
    ensureDirs();
    this.log = log;
    this.token = mkToken();
    this.bus = new Bus({ log });
    this.registry = new Registry({ projectDir, log });
    this.entity = entity;          // Entity instance (optional); serves /lip/persona
    this.runner = runner;          // Runner instance (optional); serves /lip/run* (docs/RUNNER.md)
    this.native = new NativeRuntime({ bus: this.bus, registry: this.registry, entity, log });   // native windows (docs/NATIVE.md)
    this.server = null;
    this.port = 0;
    this.runFile = null;
    this.opened = [];              // {windowId, unique, url, at}
    this.uploads = [];
  }

  async start(preferredPort = Number(process.env.LETS_PORT) || 0) {
    this.server = http.createServer((req, res) => this._handle(req, res).catch((err) => {
      this.log('host', `error ${req.method} ${redact(req.url)}: ${err.stack || err}`);
      if (!res.headersSent) { res.writeHead(500, { 'content-type': 'text/plain' }); }
      res.end('internal error');
    }));
    this.server.keepAliveTimeout = 65_000;
    const listen = () => new Promise((resolve, reject) => {
      this.server.removeAllListeners('error');        // a listener left from an earlier try never fires; do not stack them
      this.server.once('error', reject);
      this.server.listen(preferredPort, '127.0.0.1', resolve);
    });
    await listen();
    // a free port the OS hands out may be one browsers and fetch() refuse (the WHATWG "bad ports": 6000, 6665-6669, 10080, …);
    // the mod, the prompt hook and the browser pane all reach the host through fetch, so pick another
    for (let i = 0; i < 8 && !preferredPort && BAD_PORTS.has(this.server.address().port); i++) {
      await new Promise((resolve) => this.server.close(resolve));
      await listen();
    }
    this.port = this.server.address().port;
    this.runFile = path.join(DIRS.run, `host-${process.pid}.json`);
    writeJson(this.runFile, { pid: process.pid, port: this.port, token: this.token, started: Date.now(), version: VERSION, cwd: process.cwd() });
    this._hb = setInterval(() => this.bus.heartbeat(), 15_000);
    this._hb.unref?.();
    this.log('host', `listening on http://127.0.0.1:${this.port}`);
    return this.port;
  }

  stop() {
    clearInterval(this._hb);
    try { this.native.stop(); } catch { /* ignore */ }
    try { if (this.runFile) fs.unlinkSync(this.runFile); } catch { /* ignore */ }
    this.server?.close();
  }

  /**
   * Opens a native window (a pane inside Claude Code, drawn by the lets-native
   * mod) instead of a browser page. `queue` runs before the view attaches, so a
   * restore command queued there is the first thing the view handles.
   */
  openNative(unique, { windowId = null, args = {}, queue = null } = {}) {
    const w = (windowId ? String(windowId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) : '') || rid('w').slice(2, 14);
    const fresh = !this.bus.windows.has(w);
    this.bus.window(w, unique, 'native');
    try {
      if (typeof queue === 'function') queue(w);
      const r = this.native.open(unique, { windowId: w, args });
      this.opened.push({ windowId: w, unique, mode: 'native', at: Date.now() });
      return r;
    } catch (err) {
      if (fresh) this.bus.drop(w);          // nothing attached: leave no ghost window behind
      throw err;
    }
  }

  get origin() { return `http://127.0.0.1:${this.port}`; }

  /** Build the URL that opens a unique in a new window. */
  windowUrl(unique, { windowId = null, args = {} } = {}) {
    const w = windowId || rid('w').slice(2, 14);
    const hash = new URLSearchParams({ w, t: this.token, ...Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])) });
    const url = `${this.origin}/u/${unique}/#${hash}`;
    this.bus.window(w, unique);
    this.opened.push({ windowId: w, unique, url, at: Date.now() });
    return { url, windowId: w };
  }

  // ---- request handling ------------------------------------------------------

  _authed(req, url) {
    const t = req.headers['x-lets-token'] || url.searchParams.get('t');
    return t === this.token;
  }

  async _handle(req, res) {
    const url = new URL(req.url, this.origin);
    const p = url.pathname;
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-security-policy', CSP);
    res.setHeader('x-content-type-options', 'nosniff');

    if (p === '/' ) return this._json(res, 200, { lets: VERSION, uniques: this.registry.list().map((u) => u.name), windows: this.bus.windowList().length });
    if (p === '/health') return this._json(res, 200, { ok: true, version: VERSION, port: this.port });

    // LIP endpoints (token required)
    if (p.startsWith('/lip/')) {
      if (!this._authed(req, url)) return this._json(res, 401, { error: 'bad token' });
      if (p === '/lip/stream' && req.method === 'GET') return this._stream(req, res, url);
      if (p === '/lip/event' && req.method === 'POST') return this._event(req, res, url);
      if (p === '/lip/upload' && req.method === 'POST') return this._upload(req, res, url);
      if (p === '/lip/drain' && req.method === 'GET') return this._drain(res, url);
      if (p === '/lip/command' && req.method === 'POST') return this._command(req, res, url);
      if (p === '/lip/listen' && req.method === 'GET') return this._listen(res, url);
      if (p === '/lip/persona' && req.method === 'GET') return this._json(res, 200, this.entity ? this.entity.personaForShell() : {});
      if (p === '/lip/entity' && req.method === 'GET') return this._json(res, 200, this.entity ? this.entity.full() : {});
      if (p === '/lip/windows' && req.method === 'GET') return this._json(res, 200, this.bus.windowList());
      if (p === '/lip/run/info' && req.method === 'GET') return this._runInfo(res, url);
      if (p === '/lip/run/consent' && req.method === 'POST') return this._runConsent(req, res, url);
      if (p === '/lip/run' && req.method === 'POST') return this._run(req, res, url);
      if (p.startsWith('/lip/native/')) return this._native(req, res, url, p.slice(12));
      return this._json(res, 404, { error: 'unknown lip endpoint' });
    }

    // static: sdk, uniques, uploads (images only), assets
    if (req.method !== 'GET' && req.method !== 'HEAD') return this._json(res, 405, { error: 'method' });
    if (p.startsWith('/sdk/')) return this._static(res, path.join(PLUGIN_ROOT, 'sdk'), p.slice(5) || 'README.md');
    if (p.startsWith('/assets/')) return this._static(res, path.join(PLUGIN_ROOT, 'assets'), p.slice(8));
    if (p.startsWith('/uploads/')) return this._static(res, DIRS.uploads, decodeURIComponent(p.slice(9)));
    if (p.startsWith('/u/')) {
      const [, , name, ...rest] = p.split('/');
      let u = this.registry.get(name);
      if (!u || !u.ok) { this.registry.refresh(); u = this.registry.get(name); }   // a unique added since start
      if (!u || !u.ok) return this._json(res, 404, { error: `unknown unique "${name}"`, problems: u?.problems });
      if (rest.length === 0) { res.writeHead(302, { location: `/u/${name}/${url.hash || ''}` }); return res.end(); }
      const sub = rest.join('/');
      if (sub === '' || sub === 'index.html') return this._static(res, u.dir, path.relative(u.dir, u.entry));
      // relative URLs in the entry page resolve against the entry's folder first (ui/…), then the unique root
      const entryDir = path.dirname(path.relative(u.dir, u.entry));
      const inEntryDir = path.join(entryDir, sub);
      if (entryDir !== '.' && fs.existsSync(path.resolve(u.dir, inEntryDir)) && isInside(u.dir, path.resolve(u.dir, inEntryDir))) return this._static(res, u.dir, inEntryDir);
      return this._static(res, u.dir, sub);
    }
    return this._json(res, 404, { error: 'not found' });
  }

  _json(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  _static(res, root, rel) {
    const file = path.resolve(root, rel);
    if (!isInside(root, file) && file !== path.resolve(root)) return this._json(res, 403, { error: 'forbidden' });
    let stat;
    try { stat = fs.statSync(file); } catch { return this._json(res, 404, { error: 'not found' }); }
    if (stat.isDirectory()) return this._static(res, root, path.join(rel, 'index.html'));
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': stat.size });
    fs.createReadStream(file).pipe(res);
  }

  _stream(req, res, url) {
    const w = url.searchParams.get('w') || rid('w').slice(2, 14);
    const unique = url.searchParams.get('u') || this.bus.windows.get(w)?.unique || 'unknown';
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    const win = this.bus.attach(w, unique, res);
    const hello = { lip: 1, id: rid('cm'), ts: Date.now(), dir: 'down', from: 'host', type: 'lip.hello', data: { windowId: w, unique, version: this.registry.get(unique)?.manifest?.version, caps: this.registry.get(unique)?.manifest?.capabilities || [], hostVersion: VERSION } };
    this.bus._write(res, hello);
    if (this.entity) this.bus._write(res, { lip: 1, id: rid('cm'), ts: Date.now(), dir: 'down', from: 'host', type: 'entity.persona', data: this.entity.personaForShell() });
    this.bus._write(res, { lip: 1, id: rid('cm'), ts: Date.now(), dir: 'down', from: 'host', type: 'session.listening', data: { on: this.bus.listening, at: Date.now() } });
    if (!win._announced) {
      win._announced = true;
      this.bus.push({ lip: 1, id: rid('ev'), ts: Date.now(), dir: 'up', from: 'host', type: 'session.opened', data: { windowId: w, unique, mode: 'web' } });
    }
    req.on('close', () => this.bus.detach(w, res));
  }

  async _event(req, res, url) {
    const body = await readBody(req, MAX_EVENT_BODY);
    let msgs;
    try { msgs = JSON.parse(body); } catch { return this._json(res, 400, { error: 'bad json' }); }
    const list = Array.isArray(msgs) ? msgs : [msgs];
    const w = url.searchParams.get('w');
    if (!w) return this._json(res, 400, { error: 'w (window id) required' });   // every event is bound to the window that sent it
    let accepted = 0;
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      if (!m.from || !String(m.from).endsWith(`#${w}`)) continue;                 // no spoofing other windows, the host or the hook
      if (this.bus.push(m)) accepted++;
      if (w) { const win = this.bus.windows.get(w); if (win) win.lastSeen = Date.now(); }
    }
    this._json(res, 202, { accepted });
  }

  async _upload(req, res, url) {
    const w = url.searchParams.get('w') || 'w';
    const win = this.bus.windows.get(w);
    const unique = win?.unique || 'unknown';
    const source = url.searchParams.get('source') || 'file';
    const componentId = url.searchParams.get('component') || undefined;
    const mime = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_UPLOAD) return this._json(res, 413, { error: 'too large' });
    const buf = await readBody(req, MAX_UPLOAD, true);
    const extByMime = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'text/plain': '.txt', 'application/json': '.json', 'application/pdf': '.pdf' };
    const requested = (url.searchParams.get('name') || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
    const ext = extByMime[mime] || (requested.includes('.') ? '.' + requested.split('.').pop() : '.bin');
    const dir = path.join(DIRS.uploads, unique.replace(/[^a-z0-9-]/g, ''));
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}-${source}${ext}`);
    fs.writeFileSync(file, buf);
    const isImage = mime.startsWith('image/');
    const size = isImage ? imageSize(buf) : null;
    const info = { path: file, url: `/uploads/${encodeURIComponent(path.basename(dir))}/${encodeURIComponent(path.basename(file))}`, w: size?.w, h: size?.h, bytes: buf.length, mime, source, componentId };
    this.uploads.push(info);
    this.bus.push({ lip: 1, id: rid('ev'), ts: Date.now(), dir: 'up', from: `unique:${unique}#${w}`, type: isImage ? 'media.image' : 'media.file', data: info });
    this._json(res, 200, info);
  }

  /** Down-commands over HTTP (for the CLI and debugging; Claude uses the MCP `send` tool). */
  async _command(req, res, url) {
    const body = await readBody(req, MAX_EVENT_BODY);
    let cmds;
    try { cmds = JSON.parse(body); } catch { return this._json(res, 400, { error: 'bad json' }); }
    const list = Array.isArray(cmds) ? cmds : [cmds];
    const to = url.searchParams.get('to') || undefined;
    const results = list.filter((c) => c && typeof c.type === 'string').map((c) => this.bus.send({ type: c.type, data: c.data ?? {}, ttl: c.ttl, from: c.from || 'host' }, c.to || to));
    this._json(res, 200, { results });
  }

  /** Blocking read over HTTP (for the CLI and tests): same semantics as the MCP `listen` tool. */
  async _listen(res, url) {
    const cursor = url.searchParams.get('cursor') || 'claude';
    const waitMs = Math.min(Number(url.searchParams.get('wait_ms') || 0), 100_000);
    const max = Math.min(Number(url.searchParams.get('max') || 50), 200);
    if (cursor === 'claude') this.bus.touchListening(waitMs > 0 ? 8000 : 3000);
    const got = await this.bus.wait(cursor, waitMs);
    const r = this.bus.read(cursor, { max });
    this._json(res, 200, { ...r, timedOut: waitMs > 0 && !got && r.events.length === 0, windows: this.bus.windowList() });
  }

  // ---- the runner (docs/RUNNER.md) ---------------------------------------------

  /** The window → its unique's manifest, or a 4xx. */
  _runWindow(res, url) {
    if (!this.runner) { this._json(res, 404, { error: 'unavailable', message: 'this engine has no runner' }); return null; }
    const w = url.searchParams.get('w');
    const win = w ? this.bus.windows.get(w) : null;
    if (!win) { this._json(res, 404, { error: 'bad-request', message: 'unknown window (w)' }); return null; }
    const u = this.registry.get(win.unique);
    if (!u?.ok) { this._json(res, 404, { error: 'bad-request', message: `unknown unique "${win.unique}"` }); return null; }
    return { w, unique: win.unique, manifest: u.manifest };
  }

  async _runInfo(res, url) {
    const ctx = this._runWindow(res, url);
    if (!ctx) return;
    this._json(res, 200, await this.runner.info(ctx.unique, ctx.manifest));
  }

  async _runConsent(req, res, url) {
    const ctx = this._runWindow(res, url);
    if (!ctx) return;
    if (!this.runner.enabled) return this._json(res, 403, { error: 'disabled', message: 'the runner is switched off in ~/.lets/config.json' });
    let body;
    try { body = JSON.parse(await readBody(req, 4096) || '{}'); } catch { return this._json(res, 400, { error: 'bad-request', message: 'bad json' }); }
    const allowed = this.runner.setAllowed(ctx.unique, body?.allow === true);
    this.bus.push({ lip: 1, id: rid('ev'), ts: Date.now(), dir: 'up', from: 'host', type: 'session.consent', data: { windowId: ctx.w, unique: ctx.unique, runner: allowed } });
    this._json(res, 200, { allowed, unique: ctx.unique });
  }

  /** POST /lip/run: checks (enabled, window, manifest exec, consent, language, capacity), then streams NDJSON. */
  async _run(req, res, url) {
    const ctx = this._runWindow(res, url);
    if (!ctx) return;
    if (!this.runner.enabled) return this._json(res, 403, { error: 'disabled', message: 'the runner is switched off in ~/.lets/config.json' });
    let body;
    try { body = JSON.parse(await readBody(req, 4 * 1024 * 1024) || '{}'); } catch { return this._json(res, 400, { error: 'bad-request', message: 'bad json' }); }
    const lang = String(body?.lang || '').toLowerCase();
    if (!execList(ctx.manifest).includes(lang)) return this._json(res, 403, { error: 'not-declared', message: `${ctx.unique} does not declare permissions.exec for "${lang}"` });
    if (!this.runner.allowed(ctx.unique)) return this._json(res, 403, { error: 'consent', message: `allow ${ctx.unique} to run programs on this machine first` });
    const run = String(body?.run || rid('r')).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || rid('r');
    let started = false;
    const line = (obj) => { if (!started) { started = true; res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'x-accel-buffering': 'no' }); } res.write(JSON.stringify(obj) + '\n'); };
    try {
      const result = await this.runner.run({
        lang, code: body?.code, stdin: typeof body?.stdin === 'string' ? body.stdin : '', timeoutMs: body?.timeoutMs, run,
        onChunk: (c) => line({ run, stream: c.stream, text: c.text }),
      });
      line({ run, done: true, exit: result.exit, ms: result.ms, timedOut: result.timedOut, killed: result.killed, sandbox: result.sandbox, bytes: result.bytes });
      res.end();
    } catch (err) {
      if (started) { line({ run, done: true, exit: null, error: err.code || 'error', message: err.message }); return res.end(); }
      const status = err.code === 'busy' ? 429 : err.code === 'unavailable' ? 409 : 400;
      this._json(res, status, { error: err.code || 'error', message: err.message });
    }
  }

  _drain(res, url) {
    const cursor = url.searchParams.get('cursor') || 'hook';
    const max = Math.min(Number(url.searchParams.get('max') || 50), 200);
    const r = this.bus.read(cursor, { max });
    this._json(res, 200, { ...r, windows: this.bus.windowList() });
  }

  /**
   * Native windows, for the lets-native mod and the CLI (docs/NATIVE.md §6):
   *   GET  /lip/native/sync?known=w1:3,w2:0&cols=&rows=   trees where the rev moved
   *   POST /lip/native/action?w=   {key, kind, value?}      what the person did in the pane
   *   POST /lip/native/close?w=    {reason}                 the person closed the pane
   *   POST /lip/native/open        {unique, args?, windowId?}
   *   GET  /lip/native/windows
   */
  async _native(req, res, url, sub) {
    const w = url.searchParams.get('w') || '';
    if (sub === 'sync' && req.method === 'GET') {
      const known = {};
      for (const part of String(url.searchParams.get('known') || '').split(',')) {
        const i = part.lastIndexOf(':');
        if (i > 0) known[part.slice(0, i)] = Number(part.slice(i + 1));
      }
      const viewports = {};                       // v=<id>:<cols>x<rows>,… : each pane's own size
      for (const part of String(url.searchParams.get('v') || '').split(',')) {
        const m = /^(.+):(\d+)x(\d+)$/.exec(part);
        if (m) viewports[m[1]] = { cols: Number(m[2]), rows: Number(m[3]) };
      }
      return this._json(res, 200, this.native.sync({ known, viewports, cols: Number(url.searchParams.get('cols') || 0), rows: Number(url.searchParams.get('rows') || 0), modVersion: req.headers['x-lets-native'] || null }));
    }
    if (sub === 'windows' && req.method === 'GET') return this._json(res, 200, this.native.list());
    if (req.method !== 'POST') return this._json(res, 405, { error: 'method' });
    let body = {};
    try { const raw = await readBody(req, MAX_EVENT_BODY); body = raw ? JSON.parse(raw) : {}; } catch { return this._json(res, 400, { error: 'bad json' }); }
    if (sub === 'action') { if (!w) return this._json(res, 400, { error: 'w (window id) required' }); return this._json(res, 200, this.native.action(w, body)); }
    if (sub === 'close') { if (!w) return this._json(res, 400, { error: 'w (window id) required' }); return this._json(res, 200, this.native.close(w, String(body.reason || 'person').slice(0, 40))); }
    if (sub === 'open') {
      const unique = String(body.unique || '');
      this.registry.refresh();
      try { return this._json(res, 200, this.openNative(unique, { windowId: body.windowId ? String(body.windowId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || null : null, args: body.args && typeof body.args === 'object' ? body.args : {} })); }
      catch (err) { return this._json(res, 400, { error: String(err?.message || err) }); }
    }
    return this._json(res, 404, { error: 'unknown native endpoint' });
  }
}

function readBody(req, limit, raw = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
