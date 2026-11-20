// The website (lets-site): the landing page read top to bottom, the Uniques page, and Doto in the
// Playground. A plain static page, so no engine: the checkout is served by a tiny static server here and
// the playground's own offline loopback (the real shell on a stub transport) does the answering.
//
//   node promo/scenes/site.mjs                   -> promo/footage/site.mp4 + site.json
//   node promo/scenes/site.mjs --look            a PNG of ten main beats in promo/out/shots/, no footage
//   node promo/scenes/site.mjs --look=menu,end   a PNG of those beats only
//
// What the scene must not lean on, because the page decides it by itself:
//   - the mood "sleepy" before 05:00 puts a night cap on Doto and counts a secret (lets-shell.js), so a take
//     would differ with the hour: the scene never asks for sleepy;
//   - the "Boop." line after a click on him is said about every other time (Math.random); the squish, the
//     heart and the menu come every time, so the cuts and the alt texts speak of those only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { stage, sleep, ROOT } from '../lib/rig.mjs';

const SITE = path.join(ROOT, 'lets-site');
const lookArg = process.argv.find((a) => a === '--look' || a.startsWith('--look='));
const LOOK = !!lookArg;
const LOOKS = new Set(lookArg?.includes('=') ? lookArg.split('=')[1].split(',')
  : ['landing', 'hero.boop', 'engine', 'copied', 'uniques.scrolled', 'playground', 'follow.done', 'moods.done', 'menu', 'chat.answered']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.json': 'application/json', '.ico': 'image/x-icon' };

// ------------------------------------------------------------------------------------- static server
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(SITE, rel));
  if (!file.startsWith(SITE + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': MIME['.html'] });
    fs.createReadStream(path.join(SITE, '404.html')).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// the hero's greeting opens 0.9 s after the load and stays 5.2 s: a short settle, so the take starts inside it
let s;
try { s = await stage({ url: `${origin}/index.html`, host: false, name: 'site', debugPort: Number(process.env.PROMO_DEBUG_PORT) || 9357, settle: 200 }); }
catch (err) { console.error(`  site: ${err.message}`); server.close(); process.exit(1); }
const { b, rec } = s;
const GX = b.w - 54;                         // the right gutter, outside the page's column: nothing hovers there
const LAYER = `document.querySelector('.lets-entity-layer')`;

// ------------------------------------------------------------------------------- the way out, always
// Whatever happens, the browser and the server this scene started are closed, and the recorder's frames are
// dropped (rec.stop() is what drops them, so a failed take is still encoded: its sidecar ends on "failed").
let recording = false, closing = false;
async function finish(err) {
  if (closing) return;
  closing = true;
  clearTimeout(watchdog);
  if (err) {
    console.error(`  site: ${err.message}`);
    if (recording) rec.mark('failed', { error: String(err.message).slice(0, 200) });
    if (recording || LOOK) { try { await s.shot('site-fail.png'); } catch { /* the browser is gone */ } }
  }
  try { if (LOOK) await b.close(); else await s.end(); } catch (e) { console.error(`  ${e.message}`); }
  server.close();
  process.exit(err ? 1 : 0);
}
const watchdog = setTimeout(() => finish(new Error('the scene ran over three minutes')), 180000);

// ------------------------------------------------------------------------------------------ helpers
let shotN = 0;
if (LOOK) rec.mark = (what) => { console.log(`  look  ${what}`); return 0; };
const beat = async (what, extra) => { rec.mark(what, extra); if (LOOK && LOOKS.has(what)) await s.shot(`site-${String(++shotN).padStart(2, '0')}-${what}.png`); };
/** Waits for the page to say so, and stops the scene when it never does. */
const must = async (expr, what, o) => { const v = await s.waitFor(expr, o); if (!v) throw new Error(`${what}: never seen`); return v; };

/** After a page load the pointer has not moved yet, so the rig's arrow is put where the pointer really is. No event is sent: Doto must not wake for it. */
const arrow = () => b.eval(`(() => { const c = document.getElementById('promo-cursor'); if (!c) return false; c.style.transform = 'translate(${b.pos.x}px,${b.pos.y}px)'; return true; })()`);

/** Resolves once the page has stopped scrolling. */
async function scrollRests() {
  let last = null;
  for (let i = 0; i < 40; i++) { const y = await b.eval('scrollY'); if (y === last) return y; last = y; await sleep(70); }
  return last;
}

/**
 * Scrolls with the wheel until the element's top sits `at` px from the top (or the page ends), at a reader's
 * pace: the distance is measured once and paid out in small eased wheel steps on the clock, because the
 * browser animates wheel scrolling and a loop that chases the animated position overshoots and comes back.
 */
async function scrollTo(sel, { at = 84, pxPerSec = 620, minMs = 650, maxMs = 2600 } = {}) {
  const read = () => b.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const max = Math.max(0, document.documentElement.scrollHeight - innerHeight); return { y: scrollY, want: Math.max(0, Math.min(max, Math.round(scrollY + e.getBoundingClientRect().top - ${at}))) }; })()`);
  const st = await read();
  if (!st) throw new Error(`no element ${sel}`);
  const total = Math.round(Math.abs(st.want - st.y)), dir = Math.sign(st.want - st.y);
  if (total >= 3) {
    const T = Math.max(minMs, Math.min(maxMs, (total / pxPerSec) * 1000)), t0 = performance.now();
    let sent = 0;
    while (sent < total) {
      const k = Math.min(1, (performance.now() - t0) / T);
      const d = (k >= 1 ? total : Math.round(total * (0.5 - Math.cos(Math.PI * k) / 2))) - sent;      // ease in-out
      if (d >= 6 || (k >= 1 && d > 0)) { await b.wheel(dir * d); sent += d; }
      await sleep(12);
    }
  }
  for (let i = 0; i < 6; i++) {                 // the animation ends, then any gap left is closed
    await scrollRests();
    const now = await read();
    if (!now || Math.abs(now.want - now.y) < 3) break;
    await b.wheel(now.want - now.y);
  }
  await sleep(200);
}

/** Clicks a nav link and waits for the new document to be ready. */
async function navTo(href, page) {
  await s.clickOn(`.site-nav a[href="${href}"]`, { ms: 700, after: 0 });
  await must(`location.pathname.endsWith(${JSON.stringify(page)}) && document.readyState === 'complete'`, `the page ${page}`, { timeout: 15000 });
  await arrow();
  await sleep(300);
}

/** A point in the playground's controls panel, as fractions of its box (the layout moves, the panel is the frame). */
const inPanel = async (fx, fy) => { const r = await s.rect('.pg-panel'); if (!r) throw new Error('no controls panel'); return [r.x + r.w * fx, r.y + r.h * fy]; };
const pgButton = (row, label) => ({ js: `[...document.querySelectorAll('${row} button')].find((e) => e.textContent === ${JSON.stringify(label)})` });

/** A mood button: the same entity.mood command Claude sends. Waits for Doto to wear it. */
async function mood(m) {
  await s.clickOn(pgButton('#pg-moods', m), { ms: 550, after: 0 });
  await must(`${LAYER}.dataset.mood === ${JSON.stringify(m)}`, `the mood ${m}`, { timeout: 3000, every: 40 });
  await beat(`mood.${m}`);
}

/** A reaction button: marks its start and its end as the shell reports them (data-react on the entity layer). */
async function react(name) {
  await s.clickOn(pgButton('#pg-reactions', name), { ms: 600, after: 0 });
  await must(`${LAYER}.dataset.react === ${JSON.stringify(name)}`, `the reaction ${name}`, { timeout: 2000, every: 30 });
  await beat(`react.${name}`);
  await must(`!${LAYER}.dataset.react`, `the end of ${name}`, { timeout: 8000, every: 50 });
  await beat(`react.${name}.done`);
}

/** Resolves once Doto has stopped rolling. */
async function dotoRests() {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const r = await s.rect('.lets-entity');
    if (r && last && Math.hypot(r.cx - last.cx, r.cy - last.cy) < 0.6) return r;
    last = r;
    await sleep(90);
  }
  return last;
}

/** Reaches for Doto the way the page asks ("reach for Doto slowly to catch him") and clicks him once he holds still under the pointer. */
async function boopDoto() {
  for (let i = 0; i < 5; i++) {
    await s.glideTo('.lets-entity', { ms: i ? 380 : 800 });
    await sleep(140);
    const held = await b.eval(`(() => { const r = document.querySelector('.lets-entity').getBoundingClientRect(); const x = ${b.pos.x}, y = ${b.pos.y}; return ${LAYER}.dataset.catchable === 'true' && x > r.left + 8 && x < r.right - 8 && y > r.top + 8 && y < r.bottom - 8; })()`);
    if (held) { await b.click(); return; }
  }
  throw new Error('Doto would not be caught');
}

// -------------------------------------------------------------------------------------------- the story
async function story() {
  // the copy button uses the async clipboard; a headless browser asks for it, so grant it
  try { await b.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch { /* the copy step says so if it matters */ }

  // ---- 1. the landing page ------------------------------------------------------------------------
  await b.move(690, 668);                                   // below the hero text, beside the card: on nothing
  await must(`(() => { const u = document.querySelector('.doto-bubble'); return u?.dataset.open === 'true' && u.textContent.startsWith("Hi, I'm Doto"); })()`, "the hero's greeting", { timeout: 6000, every: 50 });
  if (!LOOK) { await rec.start(); recording = true; }
  await beat('landing');
  await sleep(1200);
  // boop the hero orb: his first line. From here to engine.read is the five seconds a tour reel wants.
  await beat('hero.reach');
  await s.clickOn('#doto-hero', { ms: 800, after: 0 });
  await must(`document.querySelector('.doto-bubble').textContent.startsWith('Three nodes')`, 'the boop line', { timeout: 3000, every: 40 });
  await beat('hero.boop');
  await b.glide(GX, 470, 650);                              // off the orb, so the bubble reads
  await sleep(1000);

  await beat('scroll.start');
  await scrollTo('#engine');
  await beat('engine');
  await sleep(800);
  await beat('engine.read');
  await sleep(400);
  await scrollTo('#showcase');
  await beat('showcase');
  await sleep(1000);
  await scrollTo('#install', { pxPerSec: 1300, maxMs: 2400 });   // past three sections: a skim
  await beat('install');
  await sleep(700);
  await s.clickOn('[data-copy="install-prompt"]', { ms: 750, after: 0 });
  await must(`document.querySelector('[data-copy="install-prompt"]').textContent.includes('Copied')`, 'the copy (the clipboard was refused?)', { timeout: 3000, every: 40 });
  await beat('copied', { button: await b.eval(`document.querySelector('[data-copy="install-prompt"]').textContent`) });
  await b.glide(GX, 330, 600);
  await sleep(1100);

  // ---- 2. the Uniques page ------------------------------------------------------------------------
  await navTo('./uniques.html', 'uniques.html');
  await b.glide(GX, 410, 550);
  await beat('uniques');
  await sleep(1100);
  await scrollTo('.unique-card:nth-child(3)', { at: 90 });
  await beat('uniques.scrolled');
  await sleep(1300);

  // ---- 3. the Playground --------------------------------------------------------------------------
  await navTo('./playground.html', 'playground.html');
  await must(`document.querySelector('#pg-status')?.dataset.state === 'ok' && !!document.querySelector('.lets-entity')`, 'the playground shell', { timeout: 8000 });
  await must(`document.querySelector('.lets-bubble')?.dataset.open === 'true'`, "Doto's greeting", { timeout: 6000, every: 50 });
  await beat('playground');
  await sleep(900);
  // the hand comes down into the page and Doto rolls after it; then down to the controls
  await b.glide(...(await inPanel(0.865, 0.05)), 850);
  await sleep(500);
  await scrollTo('#pg-controls-title', { at: 76 });
  await beat('controls');
  await sleep(300);
  await beat('follow');
  await b.glide(...(await inPanel(0.178, 0.397)), 900);     // each rest is on an empty spot of the panel
  await sleep(400);
  await b.glide(...(await inPanel(0.778, 0.772)), 900);
  await sleep(400);
  await beat('follow.done');

  await beat('moods');
  for (const m of ['curious', 'alert', 'happy']) { await mood(m); await sleep(900); }
  await beat('moods.done');
  // cheer, then wave: each next button lies away from where Doto waits (up and right of the pointer), so the
  // hand never slows down beside him and catches him by accident
  await react('cheer');
  await sleep(250);
  await react('wave');
  await sleep(250);

  // the boop: rest left of him so his menu opens inside the panel, reach, click. He squishes, a heart goes up
  // and the menu opens; the playground's fake Claude adds two suggestions to it
  await b.glide(...(await inPanel(0.281, 0.835)), 700);
  await dotoRests();
  await beat('boop.reach');
  await boopDoto();
  await must(`document.querySelector('.lets-menu')?.dataset.open === 'true'`, "Doto's menu", { timeout: 3000, every: 30 });
  await beat('boop');
  const nice = `[...document.querySelectorAll('.lets-menu-item')].find((e) => e.offsetParent && e.textContent.includes('Tell me something nice'))`;
  await must(`!!(${nice})`, 'the two suggestions', { timeout: 5000, every: 50 });
  await beat('menu');
  await sleep(900);
  await s.clickOn({ js: nice }, { ms: 650, after: 0 });
  await beat('picked');
  await must(`(() => { const u = document.querySelector('.lets-bubble'); return u?.dataset.open === 'true' && u.textContent.includes('good company'); })()`, 'his answer', { timeout: 4000, every: 50 });
  await beat('said');
  await b.glide(...(await inPanel(0.778, 0.772)), 650);     // away from him and clear of where the chat opens
  await sleep(1300);

  // the chat: Ctrl+/ opens it, a line typed, the stub echoes
  await b.key('/', { ctrl: true });
  await must(`document.querySelector('.lets-chat-input') && document.activeElement === document.querySelector('.lets-chat-input')`, 'the chat panel', { timeout: 4000 });
  await sleep(500);
  await beat('chat');
  await b.type('hi Doto, what is this page?', { cps: 15 });
  await sleep(300);
  await b.key('Enter');
  await must(`(document.querySelector('.lets-chat-list')?.textContent || '').includes('In a real window, Claude answers here.')`, "the stub's answer", { timeout: 6000 });
  await beat('chat.answered');
  await sleep(1800);
  await beat('end');
}

try { await story(); await finish(null); } catch (err) { await finish(err); }
