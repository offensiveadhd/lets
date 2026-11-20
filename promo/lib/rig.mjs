// The recording rig: a real lets host with the uniques from the checkouts beside this one, a headless
// browser on a window of it, a screencast recorder, and the script's hands (a pointer the camera can see)
// and Claude's side (the engine's own tools).
//
//   const s = await stage({ unique: 'graph', name: 'graph' });      // host + browser + window + pointer + Claude's loop
//   await s.rec.start();
//   await s.clickOn('#btn-add'); s.rec.mark('added');
//   await s.claude.send('graph.node.add', { label: 'Cache' });       // what Claude would send
//   await s.end();                                                    // footage/<name>.mp4 + <name>.json, everything stopped
//
// Nothing in the footage is drawn as if it were the product. The windows are the real pages served by the
// real host; what Claude says and does in them is sent through the same tool handlers the MCP server exposes,
// by a script written ahead, because a recording cannot wait on a live model.
import { fork, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROMO = path.resolve(HERE, '..');
export const LETS = path.resolve(PROMO, '..');                 // the engine checkout
export const ROOT = path.resolve(LETS, '..');                  // the folder the lets repos sit in, side by side
export const FOOTAGE = path.join(PROMO, 'footage');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A final take (node promo/record.mjs sets PROMO_FINAL=1) is 1.5x with near-lossless frames: 1920x1080.
// Anything else is a draft: 1x and lighter frames, about a fifth of the temp space, for writing a scene.
export const FINAL = process.env.PROMO_FINAL === '1';
const MIN_FREE_MB = FINAL ? 800 : 450;            // a final take keeps about 150 MB of frames until it is encoded, a draft about 40
function freeMb(dir) { try { const s = fs.statfsSync(dir); return Math.floor((s.bavail * s.bsize) / 1048576); } catch { return null; } }

/** The uniques found beside the engine checkout: { name: folder }. */
export function siblingUniques() {
  const out = {};
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    const dir = path.join(ROOT, d.name);
    if (!/^lets-unique-/.test(d.name)) continue;
    try { out[JSON.parse(fs.readFileSync(path.join(dir, 'unique.json'), 'utf8')).name] = dir; } catch { /* not a unique */ }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ host
/** Starts an engine in a child process on a throwaway LETS_HOME, with the given uniques linked in. */
export async function startHost({ port = 0, uniques = siblingUniques(), home = null, engine = null, env = {} } = {}) {
  if (engine) env = { PROMO_ENGINE: path.resolve(engine), ...env };       // another checkout's engine/ (a vendored copy)
  const dir = home || fs.mkdtempSync(path.join(os.tmpdir(), 'lets-promo-home-'));
  fs.mkdirSync(path.join(dir, 'uniques'), { recursive: true });
  for (const [name, target] of Object.entries(uniques)) {
    const link = path.join(dir, 'uniques', name);
    if (!fs.existsSync(link)) fs.symlinkSync(target, link, 'junction');   // a junction needs no admin rights on Windows; the registry follows it
  }
  const child = fork(path.join(HERE, 'host-child.mjs'), [], {
    cwd: dir, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, LETS_HOME: dir, LETS_NO_DEFAULTS: '1', LETS_UNIQUES_DIRS: '', PROMO_PORT: String(port || ''), PROMO_PROJECT: dir, ...env },
  });
  let seq = 0;
  const waiting = new Map();
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('the host did not start')), 20000);
    child.on('message', (m) => {
      if (m.ready) { clearTimeout(t); res(m); return; }
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      m.error ? w.rej(new Error(m.error)) : w.res(m.result);
    });
    child.on('exit', (code) => { rej(new Error(`the host exited (${code})`)); for (const w of waiting.values()) w.rej(new Error('the host exited')); });
  });
  const info = await ready;
  const bad = info.uniques.filter((u) => !u.ok);
  if (bad.length) console.warn('  invalid uniques:', bad.map((u) => `${u.name}: ${u.problems.join('; ')}`).join(' | '));
  const call = (msg) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); child.send({ id, ...msg }); });
  const host = {
    ...info, home: dir,
    /** One of the engine's tools, as Claude calls it: tool('send', { commands: [...] }). */
    tool: (name, args = {}) => call({ tool: name, args }),
    windows: () => call({ windows: true }),
    /** A file under the throwaway home (to seed config or read what the engine wrote). */
    file: (...p) => path.join(dir, ...p),
    async stop() {
      try { child.send({ stop: true }); } catch { /* gone */ }
      await sleep(300);
      try { child.kill(); } catch { /* gone */ }
      if (!home) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* a junction target is never followed by rmSync */ } }
    },
  };
  return host;
}

/** Claude's side of one window: the attentive loop (so the window shows Claude listening) and the sends. */
export function claudeFor(host, windowId) {
  const handlers = [];
  const seen = [];
  let running = true;
  const match = (pat, t) => pat === '*' || pat === t || (pat.endsWith('.*') && t.startsWith(pat.slice(0, -1)));
  const loop = (async () => {
    while (running) {
      let r;
      try { r = await host.tool('listen', { wait_ms: 20000, max: 100 }); } catch { break; }
      for (const ev of r.events || []) {
        seen.push(ev);
        for (const h of [...handlers]) if (match(h.type, ev.t) && (!h.pred || h.pred(ev))) { if (h.once) handlers.splice(handlers.indexOf(h), 1); h.fn(ev); }
      }
    }
  })();
  return {
    seen, loop,
    on(type, fn) { handlers.push({ type, fn }); },
    /** Resolves with the next event of that type (a trailing .* matches a family), or null after `timeout`. */
    next(type, { timeout = 15000, pred = null } = {}) {
      return new Promise((res) => {
        const h = { type, pred, once: true, fn: (ev) => { clearTimeout(t); res(ev); } };
        const t = setTimeout(() => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); res(null); }, timeout);
        handlers.push(h);
      });
    },
    /** One command, or several in one call: send('graph.node.add', {...}) / send([{ type, data }, ...]). */
    send(type, data = {}) {
      const commands = Array.isArray(type) ? type : [{ type, data }];
      return host.tool('send', { commands, to: windowId });
    },
    say(text, { via = 'chat', mood, open_chat } = {}) { return host.tool('say', { text, via, mood, to: windowId, open_chat }); },
    /** A streamed chat answer: the text arrives in chunks, as Claude's does. */
    async stream(text, { cps = 90, chunk = 14, mood } = {}) {
      const id = `st${Date.now().toString(36)}`;
      if (mood) await host.tool('send', { commands: [{ type: 'entity.mood', data: { mood } }], to: windowId });
      const parts = text.match(new RegExp(`[\\s\\S]{1,${chunk}}(?=\\s|$)|[\\s\\S]{1,${chunk}}`, 'g')) || [text];
      for (let i = 0; i < parts.length; i++) {
        await host.tool('say', { text: parts[i], via: 'chat', to: windowId, stream_id: id, done: i === parts.length - 1, open_chat: i === 0 });
        await sleep((parts[i].length / cps) * 1000);
      }
    },
    query(type, data = {}, reply) { return host.tool('query', { type, data, reply, to: windowId }); },
    tool: (name, args) => host.tool(name, args),
    stop() { running = false; },
  };
}

// -------------------------------------------------------------------------------------------- recorder
/**
 * A screencast recorder on a driver. Frames land in a temp folder with the browser's own timestamps; stop()
 * resamples them to a constant frame rate (each output frame is the latest captured frame at that instant,
 * so a burst of repaints never stretches time and a quiet second never shrinks) and encodes with ffmpeg.
 * Marks are taken on the same clock and saved beside the clip.
 */
export function recorder(b, name, { out = FOOTAGE, fps = 30, quality = FINAL ? 85 : 55 } = {}) {
  const FW = Math.round(b.w * b.scale), FH = Math.round(b.h * b.scale);
  let dir = null;                                  // made when the recording starts: a look that never records leaves nothing behind
  const drop = () => { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } dir = null; } };
  const frames = [];
  const marks = [];
  let t0 = null, wall0 = null, stopped = false;
  const onFrame = (msg) => {
    if (msg.method !== 'Page.screencastFrame') return;
    const { data, metadata, sessionId } = msg.params;
    b.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (stopped) return;
    if (frames.length % 90 === 89) {               // a take must never be what fills the disk
      const free = freeMb(os.tmpdir());
      if (free !== null && free < 250) { stopped = true; console.error(`  ${name}: ${free} MB free on the temp drive, the recording stops here`); return; }
    }
    const ts = metadata.timestamp;
    if (t0 === null) { t0 = ts; wall0 = performance.now() / 1000; }
    const file = path.join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: ts - t0 });
  };
  const now = () => (wall0 === null ? 0 : performance.now() / 1000 - wall0);
  return {
    name, marks, frames,
    async start() {
      const free = freeMb(os.tmpdir());
      if (free !== null && free < MIN_FREE_MB) throw new Error(`${name}: ${free} MB free on the temp drive, a take wants ${MIN_FREE_MB} MB of headroom; not recording`);
      dir = fs.mkdtempSync(path.join(os.tmpdir(), `lets-promo-rec-${name}-`));
      process.once('exit', drop);                  // a scene that dies mid-take leaves no frames behind
      b.listeners.push(onFrame);
      await b.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: FW, maxHeight: FH, everyNthFrame: FINAL ? 1 : 2 });
      // the first frame comes with a repaint: nudge one so the clock starts now
      await b.eval(`(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01'; document.body.appendChild(d); setTimeout(() => d.remove(), 60); })()`);
      for (let i = 0; i < 200 && t0 === null; i++) await sleep(20);
      if (t0 === null) throw new Error(`${name}: the screencast gave no frame`);
    },
    now,
    /** Notes what just happened, in seconds from the clip's start; the cuts and the camera follow these. */
    mark(what, extra = {}) {
      const t = +now().toFixed(3);
      marks.push({ t, what, ...extra });
      console.log(`  ${t.toFixed(1).padStart(6)}s  ${what}${Object.keys(extra).length ? '  ' + JSON.stringify(extra) : ''}`);
      return t;
    },
    async stop() {
      const end = now();
      stopped = true;
      await b.send('Page.stopScreencast').catch(() => {});
      const i0 = b.listeners.indexOf(onFrame);
      if (i0 >= 0) b.listeners.splice(i0, 1);
      if (frames.length < 2) { drop(); throw new Error(`${name}: no frames`); }
      const total = Math.ceil(end * fps);
      const lines = [];
      let i = 0;
      for (let k = 0; k < total; k++) {
        const t = k / fps;
        while (i + 1 < frames.length && frames[i + 1].t <= t) i++;
        lines.push(`file '${frames[i].file.replace(/\\/g, '/')}'`, `duration ${(1 / fps).toFixed(6)}`);
      }
      lines.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
      const list = path.join(dir, 'list.txt');
      fs.writeFileSync(list, lines.join('\n'));
      fs.mkdirSync(out, { recursive: true });
      const mp4 = path.join(out, `${name}.mp4`);
      const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-r', String(fps), '-i', list,
        '-vf', `scale=${FW}:${FH}:flags=lanczos,format=yuv420p`, '-r', String(fps), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
      drop();
      if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
      const meta = { name, fps, width: FW, height: FH, css: { width: b.w, height: b.h }, seconds: +end.toFixed(3), captured: frames.length, capturedFps: +(frames.length / end).toFixed(1), final: FINAL, marks };
      fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(meta, null, 2));
      console.log(`  -> ${path.relative(PROMO, mp4)}  ${end.toFixed(1)} s, ${frames.length} frames captured (${meta.capturedFps} fps)`);
      return meta;
    },
  };
}

// --------------------------------------------------------------------------------------------- pointer
// A screencast holds no OS cursor, so the page gets one the camera can see: an arrow that follows the real
// pointer events, a ring on every press. It listens in the capture phase and touches nothing else.
const CURSOR_JS = `(() => {
  if (window.__promoCursor) return;
  const make = () => {
    if (document.getElementById('promo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'promo-cursor';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;will-change:transform;transform:translate(-100px,-100px)';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '26'); svg.setAttribute('height', '30'); svg.setAttribute('viewBox', '0 0 26 30');
    svg.style.cssText = 'position:absolute;left:-2px;top:-2px;width:26px;height:30px;max-width:none;max-height:none;overflow:visible;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));transform-origin:3px 3px;transition:transform .09s ease-out';
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M3 2.5 L3 22.5 L8.2 17.6 L11.9 26.2 L15.3 24.7 L11.7 16.3 L18.8 16.3 Z');
    p.setAttribute('fill', '#ffffff'); p.setAttribute('stroke', '#120b1f'); p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p); c.appendChild(svg);
    (document.body || document.documentElement).appendChild(c);
    const ring = (x, y, right) => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:' + (x - 16) + 'px;top:' + (y - 16) + 'px;width:32px;height:32px;border-radius:50%;z-index:2147483646;pointer-events:none;border:2px solid ' + (right ? '#ff6bd6' : '#6bf0ff') + ';box-shadow:0 0 12px ' + (right ? 'rgba(255,107,214,.6)' : 'rgba(107,240,255,.6)');
      (document.body || document.documentElement).appendChild(r);
      r.animate([{ transform: 'scale(.35)', opacity: .95 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => r.remove();
    };
    const at = (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; };
    addEventListener('mousemove', at, { capture: true, passive: true });
    addEventListener('pointermove', at, { capture: true, passive: true });
    addEventListener('mousedown', (e) => { at(e); svg.style.transform = 'scale(.82)'; ring(e.clientX, e.clientY, e.button === 2); }, { capture: true, passive: true });
    addEventListener('mouseup', () => { svg.style.transform = ''; }, { capture: true, passive: true });
    window.__promoCursor = c;
  };
  if (document.body) make(); else addEventListener('DOMContentLoaded', make);
})()`;

/** Puts the visible pointer in this page and every page loaded after it. */
export async function installCursor(b) {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: CURSOR_JS });
  await b.eval(CURSOR_JS);
}

// --------------------------------------------------------------------------------------------- helpers
/** Polls a page expression until it is truthy. */
export async function waitFor(b, expr, { timeout = 15000, every = 100 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { const v = await b.eval(expr); if (v) return v; } catch { /* retry */ } await sleep(every); }
  return false;
}

/**
 * The box of an element, in CSS pixels. `target` is a selector, or { js } for an expression that returns an
 * element (or a {x, y, width, height} box), or { text, within? } for the first visible element with that text.
 */
export async function rect(b, target) {
  const expr = typeof target === 'string' ? `document.querySelector(${JSON.stringify(target)})`
    : target.js ? `(${target.js})`
    : `[...(document.querySelector(${JSON.stringify(target.within || 'body')}) || document.body).querySelectorAll(${JSON.stringify(target.tag || 'button, a, [role=button], [role=menuitem], [role=tab], label, summary, li, span, div')})].find((e) => e.offsetParent !== null && (e.textContent || '').trim()${target.exact === false ? `.includes(${JSON.stringify(target.text)})` : ` === ${JSON.stringify(target.text)}`})`;
  return b.eval(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect ? e.getBoundingClientRect() : e; return { x: r.x ?? r.left, y: r.y ?? r.top, w: r.width, h: r.height, cx: (r.x ?? r.left) + r.width / 2, cy: (r.y ?? r.top) + r.height / 2 }; })()`);
}

/** Glides the pointer to an element (its centre, or a point given as fractions of its box). */
export async function glideTo(b, target, { ms = 650, fx = 0.5, fy = 0.5, dx = 0, dy = 0 } = {}) {
  const r = await rect(b, target);
  if (!r) throw new Error(`no element for ${JSON.stringify(target)}`);
  await b.glide(r.x + r.w * fx + dx, r.y + r.h * fy + dy, ms);
  return r;
}

/** Glide, a beat, click. */
export async function clickOn(b, target, { ms = 650, pause = 140, after = 250, ...o } = {}) {
  const r = await glideTo(b, target, { ms, ...o });
  await sleep(pause);
  await b.click(b.pos.x, b.pos.y, o);
  await sleep(after);
  return r;
}

// ----------------------------------------------------------------------------------------------- stage
/**
 * Everything a scene needs: a host, a browser on one window of a unique, the pointer, Claude's loop and a
 * recorder. `end()` saves the clip and stops it all.
 */
export async function stage({ unique, name = unique, w = 1280, h = 720, scale = FINAL ? 1.5 : 1, debugPort = Number(process.env.PROMO_DEBUG_PORT) || 9351, args = {}, resume = null, settle = 1500, host = null, hostOptions = {}, url = null, fps = 30 } = {}) {
  // host: false with a url records a plain page (the website, say): no engine, no Claude
  const own = host === null;
  if (own) host = await startHost(hostOptions);
  const b = await launch({ w, h, scale, port: debugPort });
  let windowId = null;
  if (!url) {
    const o = await host.tool('open', { unique, args, brief: false, ...(resume ? { resume } : {}) });
    if (o.error) { await b.close(); if (own) await host.stop(); throw new Error(`open ${unique}: ${o.error} ${JSON.stringify(o.problems || '')}`); }
    url = o.url; windowId = o.windowId;
  }
  const claude = host ? claudeFor(host, windowId) : null;   // listening before the page loads: the window opens on a green dot
  await installCursor(b);
  await b.goto(url, { settle });
  await b.move(b.pos.x, b.pos.y);
  const rec = recorder(b, name, { fps });
  const s = {
    b, host, claude, rec, windowId, url, sleep,
    waitFor: (expr, o) => waitFor(b, expr, o),
    rect: (t) => rect(b, t),
    glideTo: (t, o) => glideTo(b, t, o),
    clickOn: (t, o) => clickOn(b, t, o),
    /** A PNG of the page as it is now, for a look while writing a scene. */
    shot: (file) => b.shot(path.isAbsolute(file) ? file : path.join(PROMO, 'out', 'shots', file)),
    async end() {
      let meta = null;
      try { meta = await rec.stop(); } catch (err) { console.error(`  ${err.message}`); }
      claude?.stop();
      await b.close();
      if (own) await host.stop();
      return meta;
    },
  };
  // A scene that throws, or is stopped with Ctrl+C, would leave the browser and the host running: end them first.
  let bailing = false;
  const bail = (why) => async (err) => {
    if (bailing) return;
    bailing = true;
    console.error(`  ${name}: ${why}${err ? `: ${err?.stack || err}` : ''}`);
    try { await Promise.race([s.end(), sleep(20000)]); } catch { /* as far as it got */ }
    process.exit(1);
  };
  process.once('uncaughtException', bail('the scene threw'));
  process.once('unhandledRejection', bail('the scene threw'));
  process.once('SIGINT', bail('stopped'));
  process.once('SIGTERM', bail('stopped'));
  return s;
}
