// A zero-dependency headless browser driver over CDP (Node 22+: global WebSocket and fetch).
//
//   import { launch } from './cdp.mjs';
//   const b = await launch({ w: 1280, h: 720, scale: 1.5 });
//   await b.goto(url); await b.eval('document.title'); await b.shot('out.png'); await b.close();
//
// It drives Edge (or any Chromium: set PROMO_BROWSER to the executable). Input goes through CDP's
// Input domain, so the page sees trusted pointer and key events, the same as from a hand.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.PROMO_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);

const VK = {
  Tab: 9, Enter: 13, Escape: 27, Backspace: 8, Delete: 46, Home: 36, End: 35, ' ': 32, Space: 32,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, F5: 116, Shift: 16, Control: 17, Alt: 18,
};
// Punctuation on a US layout: [virtual key, code]. A character's code point is not its key: sent that way,
// a full stop would go out as virtual key 46, which is Delete, and a dollar sign as 36, which is Home.
const OEM = {
  ';': [186, 'Semicolon'], ':': [186, 'Semicolon'], '=': [187, 'Equal'], '+': [187, 'Equal'],
  ',': [188, 'Comma'], '<': [188, 'Comma'], '-': [189, 'Minus'], '_': [189, 'Minus'],
  '.': [190, 'Period'], '>': [190, 'Period'], '/': [191, 'Slash'], '?': [191, 'Slash'],
  '`': [192, 'Backquote'], '~': [192, 'Backquote'], '[': [219, 'BracketLeft'], '{': [219, 'BracketLeft'],
  '\\': [220, 'Backslash'], '|': [220, 'Backslash'], ']': [221, 'BracketRight'], '}': [221, 'BracketRight'],
  "'": [222, 'Quote'], '"': [222, 'Quote'],
  '!': [49, 'Digit1'], '@': [50, 'Digit2'], '#': [51, 'Digit3'], '$': [52, 'Digit4'], '%': [53, 'Digit5'],
  '^': [54, 'Digit6'], '&': [55, 'Digit7'], '*': [56, 'Digit8'], '(': [57, 'Digit9'], ')': [48, 'Digit0'],
};
/** The virtual key and code of a key name or a character. A character with no key of its own travels as text, with 0. */
function keyOf(key) {
  if (VK[key] !== undefined) return [VK[key], key === ' ' ? 'Space' : key];
  if (key.length !== 1) return [0, key];
  if (/[a-z]/i.test(key)) return [key.toUpperCase().charCodeAt(0), `Key${key.toUpperCase()}`];
  if (/[0-9]/.test(key)) return [key.charCodeAt(0), `Digit${key}`];
  return OEM[key] || [0, ''];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A headless browser costs about half a gigabyte of memory, and several people or agents may be recording
// on one machine. So a browser needs a slot: a lock file in the temp folder that holds the pid of the
// process using it. PROMO_SLOTS says how many may run at once (2 by default); the rest wait their turn.
const SLOTS = Math.max(1, Number(process.env.PROMO_SLOTS) || 2);
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function takeSlot() {
  const t0 = Date.now();
  let told = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const file = path.join(os.tmpdir(), `lets-promo-slot-${i}.lock`);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const fd = fs.openSync(file, 'wx');
          fs.writeSync(fd, String(process.pid));
          fs.closeSync(fd);
          if (told) console.error(`  a browser slot came free after ${Math.round((Date.now() - t0) / 1000)} s`);
          return file;
        } catch { /* taken: is its owner still there? */ }
        let pid = NaN;
        try { pid = Number(fs.readFileSync(file, 'utf8')); } catch { /* being written or just removed */ }
        if (pid && pidAlive(pid)) break;                    // a live owner: try the next slot
        if (!pid && attempt === 0) { await sleep(120); continue; }
        try { fs.unlinkSync(file); } catch { break; }       // a dead owner's lock: clear it and try once more
      }
    }
    if (!told) { console.error(`  waiting for a browser slot (${SLOTS} at a time on this machine; this can take minutes)`); told = true; }
    if (Date.now() - t0 > 30 * 60 * 1000) throw new Error('no browser slot came free in 30 minutes');
    await sleep(1500 + Math.random() * 1500);
  }
}

export async function launch({ w = 1280, h = 720, scale = 1, port = 9333, profile = null } = {}) {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('no Chromium found: set PROMO_BROWSER to an Edge or Chrome executable');
  const slot = await takeSlot();
  const freeSlot = () => { try { if (Number(fs.readFileSync(slot, 'utf8')) === process.pid) fs.unlinkSync(slot); } catch { /* already free */ } };
  process.once('exit', freeSlot);
  const userDir = profile || fs.mkdtempSync(path.join(os.tmpdir(), 'lets-promo-browser-'));
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    `--window-size=${w},${h}`, '--hide-scrollbars', '--no-first-run', '--no-proxy-server', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', `--force-device-scale-factor=${scale}`, '--font-render-hinting=none',
    // a throwaway profile must stay small and quiet: no component or model downloads, no sync, no cache to speak of
    '--disable-component-update', '--disable-background-networking', '--disable-sync', '--disable-default-apps',
    '--no-default-browser-check', '--disable-extensions', '--disk-cache-size=1', '--media-cache-size=1', 'about:blank',
  ], { stdio: 'ignore' });
  const exited = new Promise((res) => proc.once('exit', res));
  let targets = null;
  for (let i = 0; i < 100 && !targets; i++) {
    await sleep(150);
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* not up yet */ }
  }
  if (!targets) { try { proc.kill(); } catch { /* ignore */ } freeSlot(); throw new Error(`the browser did not come up on port ${port}`); }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) for (const l of [...listeners]) l(msg);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const once = (method, timeout = 20000) => new Promise((res, rej) => {
    const t = setTimeout(() => { listeners.splice(listeners.indexOf(l), 1); rej(new Error(`timeout waiting for ${method}`)); }, timeout);
    const l = (msg) => { if (msg.method === method) { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); res(msg.params); } };
    listeners.push(l);
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false });

  const pos = { x: Math.round(w * 0.5), y: Math.round(h * 0.55) };       // where the pointer is
  const mods = (o = {}) => (o.alt ? 1 : 0) | (o.ctrl ? 2 : 0) | (o.meta ? 4 : 0) | (o.shift ? 8 : 0);
  const mouse = (type, x, y, o = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: o.button || 'none', buttons: o.buttons ?? 0, clickCount: o.clickCount || 0, modifiers: mods(o), deltaX: o.dx || 0, deltaY: o.dy || 0 });

  const b = {
    w, h, scale, listeners, send, sleep, pos,
    /** Loads a URL and waits for the load event. A same-document navigation (only the #hash differs) fires none: pass wait: null. */
    async goto(url, { wait = 'Page.loadEventFired', settle = 800 } = {}) {
      const p = wait ? once(wait) : Promise.resolve();
      await send('Page.navigate', { url });
      await p;
      await sleep(settle);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
    async shot(file, { clip = null, format = 'png' } = {}) {
      const r = await send('Page.captureScreenshot', { format, captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async resize(width, height) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }); },

    // ---- the pointer ---------------------------------------------------------------------------------
    /** Moves the pointer there in one step. */
    async move(x, y, o = {}) { pos.x = x; pos.y = y; await mouse('mouseMoved', x, y, o); },
    /** Glides the pointer there over `ms`, eased; the steps follow the clock, so a busy renderer drops steps and never stretches time. */
    async glide(x, y, ms = 600, o = {}) {
      const x0 = pos.x, y0 = pos.y, t0 = performance.now();
      const bend = Math.min(60, Math.hypot(x - x0, y - y0) * 0.12) * (o.bend ?? 1);    // a slight arc, as a wrist makes
      const nx = -(y - y0), ny = x - x0, nl = Math.hypot(nx, ny) || 1;
      for (;;) {
        const k = Math.min(1, (performance.now() - t0) / ms);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;          // ease in-out cubic
        const arc = Math.sin(Math.PI * e) * bend;
        await mouse('mouseMoved', x0 + (x - x0) * e + (nx / nl) * arc, y0 + (y - y0) * e + (ny / nl) * arc, o);
        if (k >= 1) break;
        await sleep(12);
      }
      pos.x = x; pos.y = y;
    },
    async down(o = {}) { await mouse('mousePressed', pos.x, pos.y, { button: o.button || 'left', buttons: o.button === 'right' ? 2 : 1, clickCount: o.clickCount || 1, ...o }); },
    async up(o = {}) { await mouse('mouseReleased', pos.x, pos.y, { button: o.button || 'left', buttons: 0, clickCount: o.clickCount || 1, ...o }); },
    /** A click where the pointer is, or at (x, y) after a move. */
    async click(x = pos.x, y = pos.y, o = {}) {
      if (x !== pos.x || y !== pos.y) await b.move(x, y, o);
      await b.down(o); await sleep(o.hold ?? 70); await b.up(o);
    },
    async dblclick(x = pos.x, y = pos.y, o = {}) {
      if (x !== pos.x || y !== pos.y) await b.move(x, y, o);
      await b.down({ ...o, clickCount: 1 }); await sleep(50); await b.up({ ...o, clickCount: 1 });
      await sleep(70);
      await b.down({ ...o, clickCount: 2 }); await sleep(50); await b.up({ ...o, clickCount: 2 });
    },
    async rightclick(x = pos.x, y = pos.y, o = {}) { await b.click(x, y, { ...o, button: 'right' }); },
    /** Press at the pointer, glide to (x, y) with the button held, release. */
    async dragTo(x, y, ms = 700, o = {}) {
      await b.down(o); await sleep(120);
      await b.glide(x, y, ms, { ...o, button: 'left', buttons: 1, bend: 0.4 });
      await sleep(120); await b.up(o);
    },
    async wheel(dy, o = {}) { await mouse('mouseWheel', pos.x, pos.y, { ...o, dy }); },

    // ---- the keyboard --------------------------------------------------------------------------------
    /** Inserts text at the caret, the way an IME or a paste does (no key events). */
    async insert(text) { await send('Input.insertText', { text }); },
    /** One key, down and up. Printable keys pass `text` so inputs receive the character. */
    async key(key, o = {}) {
      const [vk, kc] = keyOf(key);
      const code = o.code || kc;
      const modifiers = mods(o);
      const printable = key.length === 1 && !o.ctrl && !o.alt && !o.meta;
      const text = o.text ?? (printable ? key : key === 'Enter' ? '\r' : '');
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, text, unmodifiedText: text });
      if (o.hold) await sleep(o.hold);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    },
    async keyDown(key, o = {}) { const [vk, kc] = keyOf(key); await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: o.code || kc, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods(o) }); },
    async keyUp(key, o = {}) { const [vk, kc] = keyOf(key); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: o.code || kc, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods(o) }); },
    /** Types text a character at a time, at about `cps` characters a second, with a hand's unevenness. */
    async type(text, { cps = 16, jitter = 0.35 } = {}) {
      for (const ch of text) {
        if (ch === '\n') await b.key('Enter'); else await b.key(ch);
        await sleep((1000 / cps) * (1 + (Math.random() * 2 - 1) * jitter));
      }
    },

    /**
     * Closes the whole browser. On Windows the process that was started is only a launcher: it exits at once
     * and the real browser lives on, so killing it closes nothing and the profile folder stays locked. The
     * browser is asked to close on its own DevTools endpoint instead, and the folder goes once the port is silent.
     */
    async close() {
      const up = async () => { try { return await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).json(); } catch { return null; } };
      try { ws.close(); } catch { /* ignore */ }
      const v = await up();
      if (v?.webSocketDebuggerUrl) {
        await new Promise((res) => {
          const done = () => res();
          const t = setTimeout(done, 3000);
          try {
            const bw = new WebSocket(v.webSocketDebuggerUrl);
            bw.onopen = () => bw.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
            bw.onclose = () => { clearTimeout(t); done(); };
            bw.onerror = () => { clearTimeout(t); done(); };
          } catch { clearTimeout(t); done(); }
        });
      }
      for (let i = 0; i < 25 && (await up()); i++) await sleep(200);
      if (proc.exitCode === null && proc.signalCode === null) {
        // only the process tree this driver started, by its pid: never by image name
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
        else { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }
        await Promise.race([exited, sleep(1500)]);
      }
      if (!profile) {
        for (let i = 0; i < 20; i++) {
          try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* a process is still letting go */ }
          if (!fs.existsSync(userDir)) break;
          await sleep(250);
        }
      }
      freeSlot();
    },
  };
  return b;
}
