// mors: talk in Morse. The hand keys HI on the one key, asks Doto to spell CLAUDE (Claude shows the ghost),
// keys two letters of it and lets Tab and Shift+Tab key the rest, sees Claude answer HI on the magenta track,
// turns on the read-back, and sends the message to Claude.
//
// Timing is the craft. A CDP round trip is too uneven for dots and dashes, so every press of Space is a
// KeyboardEvent dispatched inside the page: a timer to just short of the moment, then a spin on the clock.
// Each event counts from the one before it, so a late timer shifts the rest of the letter and never squeezes
// a gap, and the window reads e.timeStamp for the press length. A machine under load can still hold a timer
// back by a whole unit, so the scene checks what the window decoded (the mors.changed Claude receives, the
// ghost Claude sees accepted, the export) and, when the hand slipped, throws the take away and records
// another from a clean window. A take that failed is never encoded.
//
//   node promo/scenes/mors.mjs          one take, up to three tries
//   node promo/scenes/mors.mjs --dry    a rehearsal: the whole scene with no recorder, nothing written
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stage, sleep } from '../lib/rig.mjs';

const U = 100;                                   // ms per unit: 12 wpm, the window's default, so the wpm chip stays put
const TAKES = 3;
const DRY = process.argv.includes('--dry');
const PORT = Number(process.env.PROMO_DEBUG_PORT) || 9354;
// Where the hand rests: right of the key. Doto follows the pointer, so he, his bubbles and his menu stay
// clear of the tape (top left) and of the key (centre), which is what every cut is about.
const REST = { x: 1040, y: 610 };

/** The hand slipped, or the window did not do what the scene needs: this take goes, the next one may pass. */
class Slip extends Error {}
const must = (ok, why) => { if (!ok) throw new Slip(why); };

// ------------------------------------------------------------------------------------------- the hand
/** The presses of a pattern ("-.-. .-..": letters apart by a space, words by " / ") as [units since the event before, event]. */
function presses(pattern) {
  const out = [];
  let gap = 0;
  for (const word of pattern.trim().split(/\s*\/\s*/)) {
    for (const letter of word.trim().split(/\s+/)) {
      for (const el of letter) { out.push([gap, 'keydown'], [el === '.' ? 1 : 3, 'keyup']); gap = 1; }
      gap = 3;
    }
    gap = 7;
  }
  return out;
}

/**
 * Keys a pattern with Space, inside the page, and resolves at the last release with the worst lateness in ms.
 * The events go to the focused element, as a key press does, so a focus the key would not work from fails here too.
 */
const keyJs = (pattern) => `(async () => {
  const U = ${U}, plan = ${JSON.stringify(presses(pattern))};
  let at = performance.now() + 60, late = 0;
  for (const [units, type] of plan) {
    at += units * U;
    const ms = at - performance.now() - 16;         // a timer can overshoot a 15.6 ms tick: stop well short and spin
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    while (performance.now() < at) { /* the last few ms on the clock itself: a timer alone lands late */ }
    const now = performance.now();
    late = Math.max(late, now - at);
    at = now;                                    // the next event counts from this one
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
  }
  return { late: Math.round(late) };
})()`;

/** What a track of the tape says: the characters of its closed letters, a space at each word gap. */
const tapeJs = (row) => `[...document.querySelectorAll('#${row} > .letter:not(.open), #${row} > .gap-word')].map((e) => e.classList.contains('gap-word') ? ' ' : e.dataset.char).join('').trim()`;
const MENU_OPEN = `document.querySelector('.lets-menu')?.dataset.open === 'true' && document.querySelectorAll('.lets-menu-item').length > 0`;
const menuItem = (label) => ({ js: `[...document.querySelectorAll('.lets-menu-item')].find((e) => e.querySelector('.lets-mi-label')?.textContent === ${JSON.stringify(label)})` });

/** Throws a take away: the browser and the host go, its frames are deleted, nothing is encoded. */
async function discard(s) {
  s.claude?.stop();
  await Promise.race([s.b.send('Page.stopScreencast').catch(() => {}), sleep(1500)]);
  await s.b.close();
  await s.host.stop();
  for (const d of fs.readdirSync(os.tmpdir())) {
    if (d.startsWith('lets-promo-rec-mors-')) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------- one take
async function take() {
  const s = await stage({ unique: 'mors', name: 'mors', debugPort: PORT });
  const { b, claude, rec } = s;
  const t0 = performance.now();
  const mark = (what, extra = {}) => {
    if (!DRY) return rec.mark(what, extra);
    console.log(`  ${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${what}${Object.keys(extra).length ? '  ' + JSON.stringify(extra) : ''}`);
    return 0;
  };
  // how many letters of the ghost are lit, waited for inside the page: one round trip, so the Tab that follows keeps its time
  const lit = (n, timeout) => b.eval(`new Promise((res) => { const t0 = performance.now(); const look = () => { if (document.querySelectorAll('#row-you .ghost-letter.done').length >= ${n}) res(true); else if (performance.now() - t0 > ${timeout}) res(false); else setTimeout(look, 15); }; look(); })`);

  /** Opens Doto's menu the way a hand does: reach for him slowly (he holds still when reached for), then a press
   *  held a touch longer than a tap, which opens the menu without a boop (a boop adds a bubble at random). */
  async function dotoMenu() {
    for (let i = 0; i < 4; i++) {
      const r = await s.rect('.lets-entity');
      must(r, 'Doto is not on the page');
      await b.glide(r.cx, r.cy, i ? 320 : 800);
      await sleep(180);
      const r2 = await s.rect('.lets-entity');
      if (Math.hypot(r2.cx - b.pos.x, r2.cy - b.pos.y) > 14) continue;     // he moved: reach again
      await b.click(r2.cx, r2.cy, { hold: 380 });
      if (await s.waitFor(MENU_OPEN, { timeout: 1500, every: 40 })) return;
    }
    throw new Slip('Doto\'s menu did not open');
  }

  try {
    // ---------------------------------------------------------------------------- before the camera rolls
    must(await s.waitFor(`document.getElementById('status-dot').dataset.status === 'open'`), 'the window did not connect');
    await b.glide(REST.x, REST.y, 400);
    // The first tone creates the AudioContext, which can cost the first press its timing: spend it on a typed
    // dot, erased at once. The two keys are dispatched on the document without bubbling, so only the window's
    // own handler hears them (Doto gasps at a Backspace) and the take starts on a calm frame at 12 wpm.
    await b.eval(`(() => { for (const [key, code] of [['.', 'Period'], ['Backspace', 'Backspace']]) document.dispatchEvent(new KeyboardEvent('keydown', { key, code, cancelable: true })); })()`);
    await sleep(250);
    must(await b.eval(`document.querySelectorAll('#row-you .el').length === 0 && document.getElementById('lamp').dataset.on === 'off' && !document.getElementById('tape-empty').hidden && document.getElementById('wpm-val').textContent === '12'`), 'the warm-up dot was not erased');

    // ------------------------------------------------------------------------------------------ 1. settled
    if (!DRY) await rec.start();                 // the minimal controller, Doto's greeting still up
    mark('open');
    if (!(await b.eval(`document.querySelector('.lets-bubble')?.dataset.open === 'true'`))) console.warn('  note: Doto\'s greeting was already gone when the take began');
    await sleep(1800);

    // ----------------------------------------------------------------------------------------------- 2. HI
    mark('key.start');
    let changed = claude.next('mors.changed', { timeout: 6000, pred: (ev) => ev.data.by === 'human' });
    const hi = await b.eval(keyJs('.... ..'));
    mark('key.letters', { lateMs: hi.late });
    let ch = await changed;                      // the word closes after 5.5 units of silence
    must(ch, 'HI did not close as a word');
    must(ch.data.text === 'HI' && ch.data.morse === '.... ..', `keyed HI, the window read "${ch.data.text}" (${ch.data.morse})`);
    must(await b.eval(tapeJs('row-you')) === 'HI', 'the tape does not show HI');
    mark('key.done', { wpm: ch.data.wpm });
    await sleep(1200);

    // ----------------------------------------------------------------------- 3. spell a word for me: the ghost
    mark('menu.spell');
    await dotoMenu();
    mark('menu.spell.open');
    await sleep(700);
    await s.clickOn(menuItem('Spell a word for me'), { ms: 450 });
    must(await s.waitFor(`!document.getElementById('spell').hidden && document.activeElement?.id === 'spell-input'`, { timeout: 3000 }), 'the spell box did not open');
    mark('spell.box');
    await sleep(350);
    const asked = claude.next('mors.ask', { timeout: 8000 });
    await b.type('Claude', { cps: 14 });
    await sleep(400);
    await b.key('Enter');
    const ask = await asked;
    must(ask && ask.data.kind === 'spell' && ask.data.question === 'Claude', 'no mors.ask {kind:"spell"} for the word');
    mark('ask', { question: ask.data.question });
    await sleep(500);                            // Claude reads it
    await claude.send('mors.suggest', { rev: ask.data.rev, text: ask.data.question.toUpperCase(), reason: 'spell' });
    must(await s.waitFor(`document.querySelectorAll('#row-you .ghost-letter').length === 6`, { timeout: 4000 }), 'the ghost did not show');
    mark('ghost.shown');
    await claude.say('Spelled *CLAUDE*. Key it, or Tab.', { via: 'entity', mood: 'curious' });
    mark('ghost.said');
    await b.glide(REST.x, REST.y, 700);          // back to rest, out of the tape's way
    await sleep(1500);

    // ------------------------------------------------- 4. two letters by hand, Tab for the next, Shift+Tab for the rest
    mark('ghost.key');
    const accepted = claude.next('mors.ghost.accept', { timeout: 14000 });
    changed = claude.next('mors.changed', { timeout: 16000, pred: (ev) => ev.data.by === 'human' && ev.data.text.replace(/ /g, '') === 'HICLAUDE' });
    const cl = await b.eval(keyJs('-.-. .-..'));
    mark('ghost.hand', { lateMs: cl.late });
    if (!(await lit(2, 700))) throw new Slip(`keyed C and L, the window read "${await b.eval(tapeJs('row-you'))}" and dropped the ghost`);
    await sleep(40);                             // the hand sees L light, then Tab: it must land inside the word (5.5 units)
    mark('ghost.tab');
    await b.key('Tab');
    must(await lit(3, 2500), 'Tab did not key the next letter of the ghost');
    await sleep(240);
    mark('ghost.rest');
    await b.key('Tab', { shift: true });
    const acc = await accepted;
    must(acc && acc.data.text === 'CLAUDE', 'the ghost was not keyed to the end');
    must(acc.data.assisted === 4, `Tab keyed ${acc.data.assisted} letters of the ghost, not 4`);
    mark('ghost.done', { assisted: acc.data.assisted });
    ch = await changed;
    must(ch && ch.data.text === 'HI CLAUDE', `the window read "${ch ? ch.data.text : await b.eval(tapeJs('row-you'))}", not HI CLAUDE`);
    mark('ghost.settled');
    await claude.send('entity.mood', { mood: 'proud' });   // the page winks by itself; Claude only sets the mood
    await sleep(600);

    // -------------------------------------------------------------------------------- 5. Claude talks Morse
    mark('play.start');
    const played = claude.next('mors.played', { timeout: 15000 });
    await claude.send('mors.play', { id: 'p1', text: 'HI' });
    must(await s.waitFor(`document.getElementById('lamp').dataset.on === 'claude'`, { timeout: 3000, every: 30 }), 'the lamp did not blink magenta');
    mark('play.lamp');
    const p = await played;
    must(p && p.data.id === 'p1', 'no mors.played');
    const reply = await b.eval(tapeJs('row-claude'));
    must(reply === 'HI', `Claude's track reads "${reply}"`);
    mark('play.done', { ms: p.data.ms });
    await sleep(300);
    await claude.say('Send it when you\'re ready.', { via: 'entity' });   // after the play, never during
    mark('play.said');
    await sleep(1800);

    // ------------------------------------------------------------------------------------- 6. read it back
    mark('menu.readback');
    await dotoMenu();
    mark('menu.readback.open');
    await sleep(500);
    await s.clickOn(menuItem('Read it back'), { ms: 450 });
    must(await s.waitFor(`document.getElementById('app').dataset.readback === 'true' && !document.getElementById('readout').hidden`, { timeout: 3000 }), 'read-back did not turn on');
    mark('readback.on');                         // Claude says nothing about it: the guide's rule
    await b.glide(REST.x, REST.y, 650);
    await sleep(1800);

    // ------------------------------------------------------------------------------------------- 7. send
    const exported = claude.next('mors.export', { timeout: 8000 });
    await s.glideTo('#btn-send', { ms: 600 });
    await sleep(100);
    mark('send');
    await b.click();
    const ex = await exported;
    must(ex && ex.data.text === 'HI CLAUDE' && ex.data.reply === '.... ..', `mors.export said "${ex?.data?.text}" with the reply "${ex?.data?.reply}"`);
    must(await s.waitFor(`!!document.querySelector('.lets-farewell')`, { timeout: 4000, every: 40 }), 'no farewell card');
    mark('farewell');
    await sleep(1200);                           // the page closes itself 1.4 s after the card shows: end on the card
    mark('end');
    console.log(`  keyed HI (${hi.late} ms late at worst) and C L (${cl.late} ms); Tab keyed ${acc.data.assisted} letters; Claude read "${ex.data.text}"`);
  } catch (err) {
    await discard(s);
    if (err instanceof Slip) { console.error(`  slip: ${err.message}`); return false; }
    throw err;
  }
  if (DRY) { await discard(s); return true; }
  const meta = await s.end();                    // footage/mors.mp4 + mors.json
  if (!meta) throw new Error('the take was not saved');
  return true;
}

for (let n = 1; n <= TAKES; n++) {
  if (n > 1) console.log(`  take ${n} of ${TAKES}, from a clean window`);
  if (await take()) process.exit(0);
}
console.error(`  FAIL: ${TAKES} takes, none clean`);
process.exit(1);
