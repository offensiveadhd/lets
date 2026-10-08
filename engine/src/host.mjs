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
import { imageSize } from './imagesize.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_EVENT_BODY = 1024 * 1024;
const CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";

export class Host {
  constructor({ log = () => {}, projectDir = process.cwd(), entity = null } = {}) {
    ensureDirs();
    this.log = log;
    this.token = mkToken();
    this.bus = new Bus({ log });
    this.registry = new Registry({ projectDir, log });
    this.entity = entity;          // Entity instance (optional); serves /lip/persona
    this.server = null;
    this.port = 0;
    this.runFile = null;
    this.opened = [];              // {windowId, unique, url, at}
    this.uploads = [];
  }

  async start(preferredPort = Number(process.env.LETS_PORT) || 0) {
    this.server = http.createServer((req, res) => this._handle(req, res).catch((err) => {
      this.log('host', `error ${req.method} ${req.url}: ${err.stack || err}`);
      if (!res.headersSent) { res.writeHead(500, { 'content-type': 'text/plain' }); }
      res.end('internal error');
    }));
    this.server.keepAliveTimeout = 65_000;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(preferredPort, '127.0.0.1', resolve);
    });
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
    try { if (this.runFile) fs.unlinkSync(this.runFile); } catch { /* ignore */ }
    this.server?.close();
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
      if (p === '/lip/persona' && req.method === 'GET') return this._json(res, 200, this.entity ? this.entity.personaForShell() : {});
      if (p === '/lip/windows' && req.method === 'GET') return this._json(res, 200, this.bus.windowList());
      return this._json(res, 404, { error: 'unknown lip endpoint' });
    }

    // static: sdk, uniques, uploads (images only), assets
    if (req.method !== 'GET' && req.method !== 'HEAD') return this._json(res, 405, { error: 'method' });
    if (p.startsWith('/sdk/')) return this._static(res, path.join(PLUGIN_ROOT, 'sdk'), p.slice(5) || 'README.md');
    if (p.startsWith('/assets/')) return this._static(res, path.join(PLUGIN_ROOT, 'assets'), p.slice(8));
    if (p.startsWith('/uploads/')) return this._static(res, DIRS.uploads, decodeURIComponent(p.slice(9)));
    if (p.startsWith('/u/')) {
      const [, , name, ...rest] = p.split('/');
      const u = this.registry.get(name);
      if (!u || !u.ok) return this._json(res, 404, { error: `unknown unique "${name}"` });
      if (rest.length === 0) { res.writeHead(302, { location: `/u/${name}/${url.hash || ''}` }); return res.end(); }
      const sub = rest.join('/');
      if (sub === '' || sub === 'index.html') return this._static(res, u.dir, path.relative(u.dir, u.entry));
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
    if (!win._announced) {
      win._announced = true;
      this.bus.push({ lip: 1, id: rid('ev'), ts: Date.now(), dir: 'up', from: 'host', type: 'session.opened', data: { windowId: w, unique } });
    }
    req.on('close', () => this.bus.detach(w, res));
  }

  async _event(req, res, url) {
    const body = await readBody(req, MAX_EVENT_BODY);
    let msgs;
    try { msgs = JSON.parse(body); } catch { return this._json(res, 400, { error: 'bad json' }); }
    const list = Array.isArray(msgs) ? msgs : [msgs];
    const w = url.searchParams.get('w');
    let accepted = 0;
    for (const m of list) {
      if (!m || typeof m !== 'object') continue;
      if (w && m.from && !String(m.from).endsWith(`#${w}`) && m.from !== 'hook') continue; // no spoofing other windows
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

  _drain(res, url) {
    const cursor = url.searchParams.get('cursor') || 'hook';
    const max = Math.min(Number(url.searchParams.get('max') || 50), 200);
    const r = this.bus.read(cursor, { max });
    this._json(res, 200, { ...r, windows: this.bus.windowList() });
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
