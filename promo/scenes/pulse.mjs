// pulse: the template's mood dial, start to end. The hand drags the ring down, nudges it with the arrow keys
// and picks the chip "wild". Claude answers each event the way GUIDE.md says: one line in Doto's voice for a
// settled value, a mood for the mode, and then the dial itself (pulse.glow, pulse.set) with the reason in the
// same call. Send to Claude ends in the farewell card; a second window on the same host, opened with
// resume: 'last', brings the dial back as it was sent.
//   node promo/scenes/pulse.mjs            the take: footage/pulse.mp4 + pulse.json
//   node promo/scenes/pulse.mjs --probe    a PNG and the list of controls, no scene
//   node promo/scenes/pulse.mjs --dry      the scene with no recorder (it needs no disk headroom): a PNG at nine beats
import { stage, startHost, sleep } from '../lib/rig.mjs';

const PROBE = process.argv.includes('--probe');
const DRY = process.argv.includes('--dry');
const host = await startHost();
let s;
try { s = await stage({ unique: 'pulse', name: 'pulse', debugPort: Number(process.env.PROMO_DEBUG_PORT) || 9355, host }); } catch (err) { await host.stop(); throw err; }
const { b, claude, rec } = s;

const within = (p, ms) => Promise.race([p, sleep(ms).then(() => null)]);
const stop = async () => { await s.end(); await host.stop(); };
const fail = async (msg) => { console.error(`  pulse: ${msg}`); await within(s.shot('pulse-fail.png').catch(() => {}), 3000); await stop(); process.exit(1); };

// --dry: the frames worth a look, as PNGs in out/shots/ (nine of them)
const LOOK = ['greeted', 'drag.done', 'value.held', 'keys.held', 'claude.mood', 'claude.set.held', 'farewell.held', 'resumed', 'end'];
const mark = async (what, extra) => { rec.mark(what, extra); if (DRY && LOOK.includes(what)) await s.shot(`pulse-dry-${what}.png`); };

const DIAL = `document.getElementById('dial')`;
const BUBBLE = `document.querySelector('.lets-bubble')`;
const valueNow = () => b.eval(`+${DIAL}.getAttribute('aria-valuenow')`);
const valueIs = (v, timeout = 3000) => s.waitFor(`+${DIAL}?.getAttribute('aria-valuenow') === ${v}`, { timeout });
const bubbleShows = (text, timeout = 4000) => s.waitFor(`${BUBBLE}?.dataset.open === 'true' && ${BUBBLE}.textContent.includes(${JSON.stringify(text)})`, { timeout });
// an event Claude has heard already, or the next one: the listen loop may deliver it before the scene asks
const heard = (type, pred = () => true, timeout = 5000) => { const hit = claude.seen.find((e) => e.t === type && pred(e)); return hit ? Promise.resolve(hit) : claude.next(type, { timeout, pred }); };

try {
  // the dial's geometry in CSS pixels: the ring is r=104 in a 260-unit viewBox, 0 at 12 o'clock, clockwise
  const dial = await s.rect('#dial');
  if (!dial) await fail('no #dial');
  const R = 104 * (dial.w / 260);
  const at = (v) => { const a = (v / 100) * 2 * Math.PI - Math.PI / 2; return { x: dial.cx + R * Math.cos(a), y: dial.cy + R * Math.sin(a) }; };

  if (PROBE) {
    await s.shot('pulse-probe.png');
    console.log('dial', JSON.stringify(dial), 'history', await b.eval('history.length'));
    console.log(await b.eval(`[...document.querySelectorAll('button, [role=slider]')].filter((e) => e.offsetParent !== null || e.tagName === 'svg').map((e) => { const r = e.getBoundingClientRect(); return (e.id || e.className.baseVal || e.className) + ' "' + (e.textContent || '').trim().slice(0, 30) + '" @' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }).join('\\n')`));
    claude.stop(); await b.close(); await host.stop(); process.exit(0);
  }

  // Where the hand rests between acts. Doto sits up and right of the pointer and his bubble opens to the right
  // of him (to the left once he is within 300 px of the right edge), so these keep both off the ring and the chips.
  const right = dial.x + dial.w, bottom = dial.y + dial.h;
  const PARK = { x: right + 210, y: bottom + 90 };      // the start: low on the right
  const BESIDE = { x: right + 20, y: dial.cy + 40 };    // after the drag: just off the ring
  const BELOW = { x: right + 30, y: bottom + 90 };      // after the chip: beside the controls
  const AWAY = { x: right + 160, y: bottom + 130 };     // after Send to Claude: clear of the farewell card

  // A press held along the ring: the pointer follows the arc from one value to another, eased, button down.
  const arc = async (from, to, ms) => {
    const t0 = performance.now();
    for (;;) {
      const q = Math.min(1, (performance.now() - t0) / ms);
      const e = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
      const p = at(from + (to - from) * e);
      await b.move(p.x, p.y, { button: 'left', buttons: 1 });
      if (q >= 1) break;
      await sleep(12);
    }
  };
  // Claude's line in the window: entity.say, the command GUIDE.md names, sent through the engine's send tool
  const say = (text, to = s.windowId) => host.tool('send', { commands: [{ type: 'entity.say', data: { text } }], to });
  // Claude's answer to a settled value (GUIDE.md): the acknowledgement ping, violet "on receipt", and exactly one line
  const answer = async (text) => {
    await claude.send([{ type: 'pulse.glow', data: { color: '#a66bff' } }, { type: 'entity.say', data: { text } }]);
    return (await s.waitFor(`${DIAL}.classList.contains('glowing')`, { timeout: 1000 })) && (await bubbleShows(text));
  };

  // The shell's own first-run greeting: Doto introduces himself 0.7 s after the window loads, for 6.5 s. The
  // camera starts on its last two seconds, and the hand waits for the bubble to close: it travels with Doto.
  await b.move(PARK.x, PARK.y);
  if (!await bubbleShows('Doto', 6000)) await fail('no greeting');
  await sleep(2600);
  if (!DRY) await rec.start();
  if (!await bubbleShows('Doto', 500)) await fail('the greeting was gone before the take began');
  await mark('greeted');
  if (!await s.waitFor(`${BUBBLE}.dataset.open !== 'true'`, { timeout: 9000 })) await fail('the greeting stayed');
  await mark('greeting.gone');
  await sleep(350);

  // 1. a real drag: press on the knob (50, at 6 o'clock), follow the ring down to 20, release
  await mark('drag.start');
  const knob = at(50);
  await b.glide(knob.x, knob.y, 700);
  await sleep(200);
  await b.down();
  await mark('drag.press');
  await sleep(120);
  await arc(50, 20, 1300);
  await sleep(140);
  await b.up();
  if (!await valueIs(20)) await fail(`the drag ended at ${await valueNow()}`);
  const v1 = 20;
  await mark('drag.done', { value: v1 });
  // the window sends the settled value 200 ms after the last move; Claude answers that one, with one line
  if (!await heard('pulse.value', (e) => e.data?.value === v1)) await fail('no pulse.value after the drag');
  await b.glide(BESIDE.x, BESIDE.y, 550);              // the hand steps off the ring, Doto follows it
  await sleep(450);
  if (!await answer('Running on fumes. Wrap it up?')) await fail('the first answer did not show');   // GUIDE.md's own line for a low value
  await mark('value.said');
  await sleep(1700);
  await mark('value.held');

  // 2. the arrow keys: the ring kept the focus from the press; two steps of 5
  await mark('keys.start');
  await b.key('ArrowUp');
  if (!await valueIs(v1 + 5)) await fail(`the first key left the dial at ${await valueNow()}`);
  await sleep(400);
  await b.key('ArrowUp');
  if (!await valueIs(v1 + 10)) await fail(`the second key left the dial at ${await valueNow()}`);
  await mark('keys.done', { value: v1 + 10 });
  if (!await heard('pulse.value', (e) => e.data?.value === v1 + 10)) await fail('no pulse.value after the keys');
  await sleep(450);
  if (!await answer('Picking up. Keep going.')) await fail('the second answer did not show');
  await mark('keys.said');
  await sleep(1500);
  await mark('keys.held');

  // 3. a mode chip: wild
  await mark('mode.start');
  await s.clickOn('.chip[data-mode="wild"]', { ms: 650 });
  if (!await s.waitFor(`document.querySelector('.chip.active')?.dataset.mode === 'wild'`, { timeout: 3000 })) await fail('the chip did not take');
  await mark('mode.picked');
  if (!await heard('pulse.mode', (e) => e.data?.mode === 'wild')) await fail('no pulse.mode');
  await b.glide(BELOW.x, BELOW.y, 600);                // the hand rests beside the controls
  await sleep(300);
  // GUIDE.md: wild -> entity.mood alert
  await claude.send('entity.mood', { mood: 'alert' });
  if (!await s.waitFor(`document.querySelector('.lets-entity-layer')?.dataset.mood === 'alert'`, { timeout: 3000 })) await fail('the mood did not change');
  await mark('claude.mood');
  await sleep(800);

  // 4. Claude moves the dial itself and says why in the same call (GUIDE.md: never set it without a reason).
  // Magenta is the guide's colour for disagreeing: wild, with the dial that low.
  await mark('claude.set');
  await claude.send([
    { type: 'pulse.glow', data: { color: '#ff6bd6', ttl: 1500 } },
    { type: 'pulse.set', data: { value: 90 } },
    { type: 'entity.say', data: { text: 'Pushed it up. Wild wants more.' } },
  ]);
  if (!await valueIs(90)) await fail('pulse.set did not land');
  if (!await bubbleShows('Pushed it up.')) await fail('the third line did not show');
  await sleep(2300);
  await mark('claude.set.held');

  // 5. Send to Claude: the handoff. The engine saves the dial as a session and tells the window to close.
  await mark('send.start');
  await s.clickOn('#send', { ms: 700, after: 0 });
  const exp = await heard('pulse.export');
  if (!exp) await fail('no pulse.export');
  if (exp.data?.value !== 90 || exp.data?.mode !== 'wild' || !exp.data?.session?.id) await fail(`the export was ${JSON.stringify(exp.data)}`);
  if (!await s.waitFor(`!!document.querySelector('.lets-farewell')`, { timeout: 5000 })) await fail('no farewell card');
  await mark('farewell');
  await b.glide(AWAY.x, AWAY.y, 800);
  // The page asks its tab to close 1.4 s after the card. A tab the page did not open stays and says so; then
  // it is Claude that closes it (GUIDE.md, step 1 of the handoff).
  const stayed = await within(s.waitFor(`/can.t close/.test(document.querySelector('.lets-farewell-sub')?.textContent || '')`, { timeout: 3500 }), 5000);
  if (stayed) { await mark('farewell.hint'); await sleep(1100); }
  await mark('farewell.held');
  if (!stayed && !(await within(b.eval('1').then(() => true, () => false), 1500))) {
    // the window closed itself: the take ends on the farewell and holds no resume
    console.log('  pulse: the tab closed itself; this take ends on the farewell, with no resume beat');
    rec.mark('end');
    b.send = () => Promise.reject(new Error('the tab is gone'));   // the recorder's stop must not wait on a closed tab
    await stop();
    process.exit(0);
  }

  // 6. the resume. In the transcript Claude has answered and the human asked to continue: Claude calls
  // open { resume: 'last' }, and the browser goes to the new window, where the engine has queued pulse.load.
  await mark('resume.go');
  const o = await host.tool('open', { unique: 'pulse', resume: 'last', brief: false });
  if (o.error || o.resumed?.error) await fail(`resume: ${o.error || o.resumed.error}`);
  // the new window's URL differs from this one only in its #hash, and a hash-only navigation loads nothing
  // (no load event): set the hash, then reload, and wait for the new window's own page
  // (the page takes its window id and token out of the address bar once it has read them, so the old
  // document is told apart by a flag, not by the hash)
  await b.eval('window.__promoOld = true');
  await b.goto(o.url, { wait: null, settle: 0 });
  await b.eval('location.reload()').catch(() => {});
  if (!await s.waitFor(`!window.__promoOld && document.readyState === 'complete' && !!document.querySelector('.lets-entity')`, { timeout: 10000 })) await fail('the resumed window did not load');
  await sleep(300);
  await b.move(b.pos.x, b.pos.y);                      // the new page learns where the pointer is
  await mark('resume.open');
  if (!await s.waitFor(`+${DIAL}?.getAttribute('aria-valuenow') === 90 && document.querySelector('.chip.active')?.dataset.mode === 'wild'`, { timeout: 6000 })) await fail('the dial did not come back');
  await mark('resumed');
  await sleep(800);
  await say('Back to wild. Where were we?', o.windowId);
  if (!await bubbleShows('Back to wild.')) await fail('the resume line did not show');
  await mark('resume.said');
  await sleep(2200);
  await mark('end');
  // what the window sent up during the take, in order: the README's table of messages is checked against this
  console.log(`  up: ${claude.seen.filter((e) => e.t.startsWith('pulse.')).map((e) => `${e.t} ${JSON.stringify({ ...e.data, session: undefined })}`).join('  ')}`);
  await stop();
  process.exit(0);
} catch (err) {
  await fail(String(err?.message || err));
}
