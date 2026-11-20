// doto: the companion, and the shell every lets window gets. Two clips, recorded one after the other
// (never at once: each is its own host and its own browser, on the same debug port).
//
//   doto    Claude parks Doto and sets the eight moods in turn (three of them with a line). Then the hand:
//           rests on him (blush), clicks him (boop: the squish, the heart, his menu), closes the menu, shakes
//           the pointer (dizzy); and Claude plays a wink.
//   shell   the window goes from listening to away and back, and a message typed while Claude was away is
//           kept and answered. Then Claude composes two cards; the hand picks an option and drags a slider,
//           and each change reaches Claude.
//
//   node promo/scenes/doto.mjs            both clips  -> footage/doto.mp4, footage/shell.mp4 (+ .json)
//   node promo/scenes/doto.mjs shell      one of them
//
// Everything Claude does here is a command Claude can send (entity.move, entity.mood, entity.say,
// entity.react, component.create, graph.node.add, graph.node.set, chat.say) through the engine's own tools.
// None of the secret moves is played: no double-click on Doto, no circling, no drag, no fifth boop, and a
// take after midnight is kept clear of the night cap (see daytime()). The clip fails if one gets in.
import { stage, sleep, claudeFor } from '../lib/rig.mjs';

const PORT = Number(process.env.PROMO_DEBUG_PORT) || 9356;
const LAYER = `document.querySelector('.lets-entity-layer')`;
const SHELL = `document.querySelector('.lets-shell')`;
const BUBBLE = `(document.querySelector('.lets-bubble[data-open="true"] .lets-bubble-body')?.textContent || '')`;
const NO_REACT = `!${LAYER}.dataset.react`;

const fail = (why) => { throw new Error(why); };
/** Waits for a page expression; the scene stops with `why` when it never turns true. */
const must = async (s, expr, why, o = {}) => (await s.waitFor(expr, { timeout: 4000, every: 50, ...o })) || fail(why);
const nearJs = (p, tol) => `(() => { const r = document.querySelector('.lets-entity').getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - ${p.x}, r.y + r.height / 2 - ${p.y}) < ${tol}; })()`;
const spot = async (s) => (await s.rect('.lets-entity')) || fail('Doto is not on the page');

/** Resolves once Doto has stopped rolling. */
async function settled(s, timeout = 4000) {
  const t0 = Date.now();
  let p = await spot(s);
  while (Date.now() - t0 < timeout) {
    await sleep(140);
    const q = await spot(s);
    if (Math.hypot(q.cx - p.cx, q.cy - p.cy) < 0.6) return q;
    p = q;
  }
  return p;
}

/**
 * Between midnight and 05:00 the shell puts a night cap on a sleepy Doto. That is one of his secret moves,
 * and the README keeps those unspoiled. A take at that hour sets the page's time zone (not the product) so
 * that its clock reads midday; at any other hour nothing is touched.
 */
async function daytime(b) {
  if (new Date().getHours() >= 5) return null;
  const east = 12 - new Date().getUTCHours();                                              // hours east of UTC where it is noon now
  const tz = east === 0 ? 'Etc/GMT' : `Etc/GMT${east > 0 ? '-' : '+'}${Math.abs(east)}`;   // POSIX sign: Etc/GMT-3 is UTC+3
  await b.send('Emulation.setTimezoneOverride', { timezoneId: tz });
  if ((await b.eval('new Date().getHours()')) < 5) fail(`the page clock still reads night under ${tz}`);
  return tz;
}

// ================================================================================================== doto
// Where things happen: the top-left of an empty board, clear of the toolbar above and of the board's own
// empty-state orb and hint in the middle. cuts/doto.json crops on this corner.
const HOME = { x: 200, y: 190 };                 // where Claude parks Doto for the moods
const REST = { x: 380, y: 420 };                 // where the hand waits meanwhile, outside the crop
const HAND = { x: HOME.x - 63, y: HOME.y + 48 }; // a hand here has Doto beside it at about HOME (his follow offset)
const HOLD = 1350;                               // each mood, a little over a second
const MOODS = [['idle'], ['happy'], ['curious', 'Next?'], ['thinking', 'On it.'], ['busy'], ['proud', 'Done. Look.'], ['sleepy'], ['alert']];

/** The hand reaches for Doto slowly (he holds still when reached for) until the pointer rests on him. */
async function reach(s) {
  const { b } = s;
  for (let i = 0; i < 5; i++) {
    const r = await spot(s);
    await b.glide(r.cx, r.cy, i ? 350 : 900);
    await sleep(200);
    const on = await b.eval(`(() => { const e = document.querySelector('.lets-entity'), r = e.getBoundingClientRect(); return e.matches(':hover') && Math.hypot(r.x + r.width / 2 - ${b.pos.x}, r.y + r.height / 2 - ${b.pos.y}) < 16; })()`);
    if (on) return true;
  }
  return false;
}

async function dotoClip() {
  const s = await stage({ unique: 'graph', name: 'doto', debugPort: PORT });
  const { b, claude, rec } = s;
  try {
    const tz = await daytime(b);
    await must(s, `${SHELL}?.dataset.listening === 'true' && ${LAYER}?.dataset.shown === 'true'`, 'the window did not settle on listening', { timeout: 8000 });

    // ------------------------------------------------------------------------------------------ settled
    await rec.start();
    rec.mark('open', tz ? { pageClock: tz } : {});
    if (!(await b.eval(`${BUBBLE}.length > 0`))) console.warn('  the greeting was not up when the camera rolled');
    await sleep(2400);

    // ------------------------------------------------------------------------------------- 1. the moods
    await b.glide(REST.x, REST.y, 900);                    // the hand goes to rest; he rolls after it
    await sleep(350);
    await claude.send('entity.move', { x: HOME.x, y: HOME.y });
    await must(s, nearJs(HOME, 1.5), 'entity.move did not bring Doto home', { timeout: 5000 });
    rec.mark('parked');
    await must(s, `${BUBBLE} === ''`, 'the greeting did not end', { timeout: 9000 });
    await sleep(600);
    for (const [mood, line] of MOODS) {
      const cmds = [{ type: 'entity.mood', data: { mood } }];
      if (line) cmds.push({ type: 'entity.say', data: { text: line, ttl: HOLD - 200 } });   // no mood on the line: the mood is the one just set
      await claude.send(cmds);
      await must(s, `${LAYER}.dataset.mood === '${mood}'`, `entity.mood did not set "${mood}"`, { timeout: 3000, every: 30 });
      if (line) await must(s, `${BUBBLE} === ${JSON.stringify(line)}`, `Doto did not say "${line}"`, { timeout: 2000, every: 30 });
      rec.mark(`mood.${mood}`, line ? { says: line } : {});
      await sleep(HOLD);
    }
    await claude.send('entity.mood', { mood: 'idle' });
    await must(s, `${LAYER}.dataset.mood === 'idle'`, 'the mood did not go back to idle', { timeout: 3000 });
    rec.mark('moods.end');
    await sleep(900);

    // ------------------------------------------------------------------------------- 2. the expressions
    rec.mark('expr.start');
    await b.glide(HAND.x, HAND.y, 950);                    // the hand comes over; he follows again and settles beside it
    await settled(s);
    rec.mark('expr.ready');
    await sleep(600);

    // blush: the pointer rests on him for 1.5 s
    if (!(await reach(s))) fail('the hand could not rest on Doto');
    rec.mark('hover');
    await must(s, `${LAYER}.dataset.react === 'blush'`, 'resting on Doto did not make him blush', { timeout: 3500, every: 30 });
    rec.mark('blush');
    await must(s, NO_REACT, 'the blush did not end', { timeout: 4000 });
    await sleep(300);

    // boop: a quick click. The squish and the heart, and his menu opens
    const clicked = claude.next('entity.click', { timeout: 5000 });
    await b.click();
    await must(s, `${LAYER}.dataset.react === 'boop'`, 'the click did not boop', { timeout: 1500, every: 30 });
    rec.mark('boop');
    const items = await must(s, `document.querySelector('.lets-menu').dataset.open === 'true' && document.querySelectorAll('.lets-menu-item').length`, 'his menu did not open', { timeout: 2000 });
    rec.mark('menu.open', { items, says: (await b.eval(BUBBLE)) || undefined });   // now and then he says a line on a boop
    if (!(await clicked)) fail('entity.click did not reach Claude');
    await sleep(1400);

    // close the menu: a click on the board beside him
    await b.glide(HAND.x, HAND.y, 600);
    await sleep(160);
    await b.click();
    await must(s, `document.querySelector('.lets-menu').dataset.open !== 'true'`, 'the menu did not close');
    rec.mark('menu.closed');
    await sleep(650);

    // dizzy: a mouse shake (three quick reversals, each swing over 40 px in under 350 ms). Side to side, so
    // nothing circles him
    rec.mark('shake');
    let dizzy = false;
    for (let tries = 0; tries < 3 && !dizzy; tries++) {
      for (let k = 0; k < 6; k++) await b.glide(HAND.x + (k % 2 ? 70 : -70), HAND.y, 105, { bend: 0 });
      await b.glide(HAND.x, HAND.y, 140, { bend: 0 });
      dizzy = await s.waitFor(`${LAYER}.dataset.react === 'dizzy'`, { timeout: 900, every: 30 });
    }
    if (!dizzy) fail('the shake did not make him dizzy');
    rec.mark('dizzy');
    await must(s, NO_REACT, 'dizzy did not end', { timeout: 4000 });
    rec.mark('dizzy.end');
    await sleep(500);

    // wink: Claude plays one
    await claude.send('entity.react', { name: 'wink' });
    await must(s, `${LAYER}.dataset.react === 'wink'`, 'entity.react did not play the wink', { timeout: 2000, every: 30 });
    rec.mark('wink');
    await must(s, NO_REACT, 'the wink did not end', { timeout: 3000 });
    await sleep(1500);
    rec.mark('end');

    const secret = claude.seen.find((ev) => ev.t === 'entity.secret');
    if (secret) fail(`a secret move got into the take: ${secret.data?.name}`);
    return await s.end();
  } catch (err) {
    console.error(`  FAIL (doto): ${err.message}`);
    await s.end();
    return null;
  }
}

// ================================================================================================= shell
// A shorter window than the others (1280x500), so that the chat header with its status dot, the chat input
// with its placeholder and the toast at the bottom all fit one wide crop.
const SHELL_H = 500;
const LISTEN_MS = 20000;                         // how long the rig's Claude loop waits in one `listen`
const LEAD = 2800;                               // the camera rolls this long before that last `listen` returns
const DESK = { x: 760, y: 150 };                 // where the hand rests while it types: between the board's empty-state orb and the chat, so Doto sits by the chat header
const INPUT = `document.querySelector('.lets-chat-input')`;
const DOT = `getComputedStyle(document.querySelector('.lets-chat-status')).backgroundColor`;
const chatHas = (who, text) => `[...document.querySelectorAll('.lets-chat-list .lets-msg-${who} .lets-msg-body')].some((e) => e.textContent.includes(${JSON.stringify(text)}))`;
const card = (id) => `.lets-card[data-id="${id}"]`;
const BACKOFF = { id: 'backoff', type: 'options', props: { title: 'Backoff', items: [
  { id: 'fixed', label: 'Fixed', hint: 'the same wait each time' },
  { id: 'linear', label: 'Linear', hint: 'a little longer each time' },
  { id: 'exponential', label: 'Exponential', hint: 'double the wait each time' },
] } };
const TRIES = { id: 'tries', type: 'slider', props: { title: 'Max attempts', min: 1, max: 8, step: 1, value: 2, label: 'attempts' } };
const TRIES_TO = 5;

async function shellClip() {
  const s = await stage({ unique: 'graph', name: 'shell', debugPort: PORT, h: SHELL_H });
  const { b, claude, rec } = s;
  let back = null;                                         // Claude's second loop, once it returns
  try {
    await must(s, `${SHELL}?.dataset.listening === 'true' && ${LAYER}?.dataset.shown === 'true'`, 'the window did not settle on listening', { timeout: 8000 });

    // ---------------------------------------------------------------------- before the camera: one exchange
    // The window stays on "listening" for as long as Claude is inside a `listen` call. So the last one is
    // pinned to a known moment (the human's message makes the loop ask again), Claude's loop is ended, and
    // the camera starts LEAD before that call runs out. The wait is real; it is only not filmed.
    await b.glide(DESK.x - 40, DESK.y + 20, 500);
    await b.key('/', { ctrl: true });                      // Ctrl+/ opens the chat with the caret in it
    await must(s, `${SHELL}.dataset.chat === 'open' && document.activeElement === ${INPUT}`, 'Ctrl+/ did not open the chat');
    const first = claude.next('chat.message', { timeout: 8000 });
    await b.type('Still with me?', { cps: 15 });
    await sleep(200);
    await b.key('Enter');
    if ((await first)?.data?.text !== 'Still with me?') fail('the first chat message did not reach Claude');
    const lastListen = performance.now();                  // the loop asked again the moment it got that
    await sleep(500);
    await claude.say('Here. Listening.');
    await must(s, chatHas('entity', 'Listening'), 'the chat did not show the answer');
    claude.stop();                                         // the turn ends: no `listen` after the one that is waiting
    await sleep(Math.max(0, lastListen + LISTEN_MS - LEAD - 450 - performance.now()));
    await b.glide(DESK.x, DESK.y, 350);                    // the hand stirs

    // --------------------------------------------------------------------------- 1. listening, then away
    await rec.start();
    if ((await b.eval(`${SHELL}.dataset.listening`)) !== 'true') fail('the window left "listening" before the camera rolled');
    rec.mark('listening', { dot: await b.eval(DOT), placeholder: await b.eval(`${INPUT}.placeholder`) });
    await must(s, `${SHELL}.dataset.listening === 'false'`, 'the window never showed "away"', { timeout: LEAD + 9000, every: 30 });
    rec.mark('away', { afterListenMs: Math.round(performance.now() - lastListen), dot: await b.eval(DOT), placeholder: await b.eval(`${INPUT}.placeholder`) });
    await sleep(1000);

    // a message typed while Claude is away: kept
    rec.mark('away.type');
    await b.type('Add a retry step.', { cps: 15 });
    await sleep(300);
    await b.key('Enter');
    const toast = await must(s, `[...document.querySelectorAll('.lets-toast-text')].map((e) => e.textContent).find((t) => /is away/.test(t))`, 'no "away" toast for a message sent while Claude was away', { timeout: 3000 });
    rec.mark('kept', { toast });
    await sleep(1500);

    // ---------------------------------------------------------------------------------- 2. and back again
    // The next prompt in Claude Code: a fresh loop. Its first `listen` turns the dot green and hands over
    // what was kept.
    back = claudeFor(s.host, s.windowId);
    const kept = back.next('chat.message', { timeout: 8000 });
    const t1 = performance.now();
    await must(s, `${SHELL}.dataset.listening === 'true'`, 'the window did not go back to "listening"', { timeout: 5000, every: 30 });
    rec.mark('back', { ms: Math.round(performance.now() - t1), dot: await b.eval(DOT) });
    if ((await kept)?.data?.text !== 'Add a retry step.') fail('the message typed while away was not delivered');
    await sleep(500);                                      // Claude reads it
    await back.send([{ type: 'graph.node.add', data: { id: 'retry', label: 'Retry', kind: 'step' } }, { type: 'entity.mood', data: { mood: 'happy' } }]);
    await back.say('Added *Retry* as a step.');
    await must(s, `!!document.querySelector('[data-node="retry"]') && ${chatHas('entity', 'Retry')}`, 'the kept message was not answered');
    rec.mark('answered');
    await sleep(1800);
    rec.mark('listening.end');

    // ------------------------------------------------------------------------------ 3. runtime components
    rec.mark('ask');
    const asked = back.next('chat.message', { timeout: 8000 });
    await b.type('Give me controls for it.', { cps: 16 });
    await sleep(250);
    await b.key('Enter');
    if ((await asked)?.data?.text !== 'Give me controls for it.') fail('the ask did not reach Claude');
    await sleep(500);
    await b.key('/', { ctrl: true });                      // the hand closes the chat: back to the board
    await must(s, `${SHELL}.dataset.chat === 'closed'`, 'Ctrl+/ did not close the chat');
    rec.mark('chat.closed');
    await sleep(600);                                      // the panel has slid out before the cards land in the dock

    const park = { type: 'entity.move', data: { to: card(BACKOFF.id) } };   // Doto beside the card he talks about
    await back.send([{ type: 'component.create', data: BACKOFF }, { type: 'component.create', data: TRIES }]);
    await must(s, `!!(document.querySelector('${card(BACKOFF.id)} .lets-opt') && document.querySelector('${card(TRIES.id)} .lets-range'))`, 'the cards did not appear');
    rec.mark('cards.shown');
    await sleep(350);
    await back.send([park, { type: 'entity.mood', data: { mood: 'curious' } }, { type: 'entity.say', data: { text: 'Made two cards. Pick one.', ttl: 2600 } }]);
    await must(s, `${BUBBLE}.startsWith('Made two cards')`, 'Doto did not say what he made');
    rec.mark('cards.said');
    await sleep(1100);

    // the hand picks an option
    const picked = back.next('component.action', { timeout: 6000, pred: (ev) => ev.data?.id === BACKOFF.id });
    await s.clickOn({ js: `[...document.querySelectorAll('${card(BACKOFF.id)} .lets-opt')].find((e) => e.querySelector('.lets-opt-label').textContent === 'Exponential')` }, { ms: 800, fx: 0.8 });
    const pick = await picked;
    if (pick?.data?.action !== 'pick' || pick.data.value !== 'exponential') fail(`the pick did not reach Claude: ${JSON.stringify(pick?.data)}`);
    rec.mark('picked', { event: pick.t, ...pick.data });
    await sleep(300);
    await back.send([park, { type: 'entity.mood', data: { mood: 'happy' } }, { type: 'entity.say', data: { text: 'Got it. Exponential.', ttl: 2200 } }]);
    await must(s, `${BUBBLE}.startsWith('Got it')`, 'Doto did not acknowledge the pick');
    rec.mark('pick.ack');
    await sleep(900);

    // the hand drags the slider
    const range = await s.rect(`${card(TRIES.id)} .lets-range`);
    if (!range) fail('no slider');
    const { min, max } = TRIES.props, THUMB = 16;
    const xOf = (v) => range.x + THUMB / 2 + ((v - min) / (max - min)) * (range.w - THUMB);
    await b.glide(xOf(TRIES.props.value), range.cy, 600);
    await sleep(150);
    const changed = back.next('component.action', { timeout: 6000, pred: (ev) => ev.data?.id === TRIES.id && ev.data.value === TRIES_TO });
    await b.dragTo(xOf(TRIES_TO), range.cy, 750);
    const change = await changed;
    if (!change) fail(`the slider did not reach ${TRIES_TO}: it reads ${await b.eval(`document.querySelector('${card(TRIES.id)} .lets-range').value`)}`);
    rec.mark('slid', { event: change.t, ...change.data });
    await back.send([{ type: 'graph.node.set', data: { id: 'retry', patch: { label: 'Retry x5, exponential' } } }, park, { type: 'entity.mood', data: { mood: 'proud' } }, { type: 'entity.say', data: { text: 'Set. Five tries.', ttl: 2400 } }]);
    await must(s, `${BUBBLE}.startsWith('Set.')`, 'Doto did not acknowledge the slider');
    rec.mark('slide.ack');
    await sleep(2000);
    rec.mark('end');

    back.stop();
    return await s.end();
  } catch (err) {
    console.error(`  FAIL (shell): ${err.message}`);
    back?.stop();
    await s.end();
    return null;
  }
}

// =================================================================================================== run
const CLIPS = { doto: dotoClip, shell: shellClip };
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const unknown = want.filter((n) => !CLIPS[n]);
if (unknown.length) { console.error(`no clip "${unknown.join(', ')}" (have: ${Object.keys(CLIPS).join(', ')})`); process.exit(2); }
let failed = 0;
for (const name of want.length ? want : Object.keys(CLIPS)) {
  console.log(`-- ${name}`);
  let meta = null;
  try { meta = await CLIPS[name](); } catch (err) { console.error(`  FAIL (${name}): ${err.message}`); }
  if (!meta) failed++;
}
process.exit(failed ? 1 : 0);
