// den: Doto's home. A developer's profile (invented) is seeded through the engine's own `entity` tool; the
// hand turns the chatty trait down, forgets a stale memory line, asks Doto what he knows and renames him.
// Every edit shows pending first; Claude's side (this script) applies it with `entity` and confirms with
// `den.refresh`, the way lets-unique-den/GUIDE.md says.
//
//   node promo/scenes/den.mjs              the take  -> footage/den.mp4 + den.json
//   DEN_LOOK=1 node promo/scenes/den.mjs   seed, open, two PNGs (the home, the memory card) and the boxes, no recording
import { startHost, stage, sleep } from '../lib/rig.mjs';

const LOOK = !!process.env.DEN_LOOK;

// ------------------------------------------------------------------------------------------- the seed
// An invented, neutral developer. Oldest first: the den shows memory newest first. Every line is learned
// seconds before the take, so every date in the footage reads "just now"; the tool takes no date.
const STALE = 'Wants grid layouts for planning boards.';
const MEMORY = [
  ['note', 'Works mostly in Go and TypeScript. The payments service is the Go one.'],
  ['style', 'Writes commit subjects in the imperative, with no trailing dot.'],
  ['preference', 'Wants test names that read as sentences.'],
  ['habit', 'Reviews pull requests after lunch, rarely before.'],
  ['style', 'Labels nodes in lowercase, without punctuation.'],
  ['note', 'Reads the nightly integration report at 9 before standup.'],
  ['habit', 'Opens graph first thing on Monday to plan the week.'],
  ['request', 'Asked to keep answers under five lines unless asked for more.'],
  ['preference', STALE],                                              // stale: the take forgets it
  ['preference', 'Prefers tree layouts over grids.'],                 // the newer line it fights, right above it
  ['habit', 'Closes the chat panel while drawing, opens it to ask.'],
  ['request', 'Asked never to rename files without asking first.'],
];
// what the answer to "What do you know about me?" cites, by a few words of each line
const CITED = ['rename files', 'tree layouts', 'under five lines', 'Monday'];

const SKILLS = [
  {
    name: 'Payments board layout', unique: 'graph', confidence: 0.7,
    triggers: ['lay out the board', 'tidy the payments graph', 'make it a tree'],
    body: [
      '## When',
      'They open "the board" (the payments service graph) or ask to tidy it.',
      '',
      '## Steps',
      '1. `graph.layout {"algo":"tree","dir":"TB"}`: they prefer trees to grids.',
      '2. Lowercase labels, no punctuation. Rename only after asking.',
      '3. Group the queue, ledger and webhook nodes; leave the rest where they are.',
      '',
      '## Pitfalls',
      'Do not move pinned nodes. Say what changed in one line.',
    ].join('\n'),
  },
  {
    name: 'Nightly report triage', unique: null, confidence: 0.6,
    triggers: ['nightly failed', 'read the nightly', 'integration report'],
    body: [
      '## When',
      'The 02:00 integration run ("nightly") has failures and they ask before standup.',
      '',
      '## Steps',
      '1. Group failures by package, flaky ones last.',
      '2. One line per group: the test, the first error line, the last commit that touched it.',
      '3. Offer to open the failing package as a graph.',
      '',
      '## Pitfalls',
      'Keep it under five lines unless they ask for more.',
    ].join('\n'),
  },
];

async function seed(host) {
  const e = async (args) => { const r = await host.tool('entity', args); if (r?.error) throw new Error(`entity ${args.action}: ${r.error}`); return r; };
  // the skills first: `teach` writes a "learned …" memory line, and those two belong at the old end of the list
  for (const sk of SKILLS) await e({ action: 'teach', ...sk });
  await e({ action: 'reinforce', name: 'Payments board layout', ok: true });
  await e({ action: 'reinforce', name: 'Payments board layout', ok: true });
  for (const [kind, text] of MEMORY) await e({ action: 'learn', kind, text });
  await e({ action: 'learn', likes: ['tree layouts', 'short labels', 'keyboard shortcuts', 'small diffs', 'dark themes'] });
  await e({ action: 'learn', dislikes: ['modal dialogs', 'long answers', 'surprise renames'] });
  await e({ action: 'learn', nicknames: { 'the board': 'the payments service graph', nightly: 'the 02:00 integration run' } });
  // trait nudges, blended in the way learn does it (70 % old, 30 % new)
  await e({ action: 'learn', traits: { chatty: 0.95, curiosity: 0.85, playful: 0.8 } });
  await e({ action: 'learn', traits: { chatty: 0.95, speed: 0.75, formality: 0.05 } });
}

// ----------------------------------------------------------------------------------------- the stage
const host = await startHost();
let s = null;
try {
  await seed(host);
  s = await stage({ host, unique: 'den', name: 'den', debugPort: Number(process.env.DEN_PORT) || 9352 });
  await take(s);
  const meta = LOOK ? {} : await s.end();
  await host.stop();
  process.exit(meta ? 0 : 1);
} catch (err) {
  console.error(`den: ${err?.message || err}`);
  if (s) {
    try { await s.shot('den-fail.png'); console.error('  the page as it was: promo/out/shots/den-fail.png'); } catch { /* the browser is gone */ }
    await s.end().catch(() => {});                // closes the browser; a take that was running is saved as far as it got
  }
  await host.stop().catch(() => {});
  process.exit(1);
}

async function take(s) {
  const { b, claude, rec } = s;
  const q = (v) => JSON.stringify(v);
  const rowSel = (key) => `[data-row="${key}"]`;
  const need = async (what, expr, timeout = 8000) => { const v = await s.waitFor(expr, { timeout }); if (!v) throw new Error(`waited ${timeout} ms for ${what}`); return v; };
  const pending = (key) => need(`${key} to show pending`, `document.querySelector(${q(rowSel(key))})?.dataset.pending === 'true'`, 5000);
  const settled = (key) => need(`${key} to lose its pending mark`, `(() => { const e = document.querySelector(${q(rowSel(key))}); return !e || e.dataset.pending !== 'true'; })()`);
  const bubbleClosed = (timeout) => s.waitFor(`document.querySelector('.lets-bubble')?.dataset.open !== 'true'`, { timeout });
  const box = async (sel) => { const r = await s.rect(sel); return r ? [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)] : null; };
  /** One Doto line when an edit is done: the working mood off, the line said proud. */
  const doto = (text) => claude.send([{ type: 'entity.mood', data: { mood: 'idle' } }, { type: 'entity.say', data: { text, mood: 'proud' } }]);
  /** What Claude does with one edit: thinking, the `entity` tool, `den.refresh`. */
  const apply = async (args) => {
    await claude.send('entity.mood', { mood: 'thinking' });
    const r = await claude.tool('entity', args);
    if (r?.error) throw new Error(`entity ${args.action}: ${r.error}`);
    await claude.send('den.refresh', {});
    return r;
  };

  const scrollTop = () => b.eval(`document.getElementById('home').scrollTop`);
  const atRest = async () => { let a = await scrollTop(); for (let i = 0; i < 40; i++) { await sleep(60); const n = await scrollTop(); if (n === a) return n; a = n; } return a; };
  /** The human scrolls the den with the wheel until the element's top sits at `y`, or the den can go no further. */
  async function scrollTo(selector, y) {
    const top = async () => { const r = await s.rect(selector); if (!r) throw new Error(`no ${selector}`); return r.y; };
    for (let i = 0; i < 60; i++) {                       // a notch at a time
      const d = (await top()) - y;
      if (Math.abs(d) < 60) break;
      const before = await scrollTop();
      await b.wheel(Math.sign(d) * Math.min(120, Math.abs(d)));
      await sleep(45);
      if (i % 8 === 7 && (await atRest()) === before) break;    // the end of the page
    }
    for (let i = 0; i < 6; i++) {                        // the last pixels, once the scroll has come to rest
      const before = await atRest();
      const d = Math.round((await top()) - y);
      if (Math.abs(d) <= 2) break;
      await b.wheel(d);
      if ((await atRest()) === before) break;
    }
    await sleep(350);
  }
  /** Waits until an element has stopped moving (a panel that slid away lets the column settle). */
  async function still(selector) {
    let a = q(await box(selector));
    for (let i = 0; i < 40; i++) { await sleep(120); const n = q(await box(selector)); if (n === a) return; a = n; }
    throw new Error(`${selector} never came to rest`);
  }
  /** Reaches for Doto the way a hand does (slow and near, so he holds still), then clicks him. */
  async function clickDoto() {
    const open = `document.querySelector('.lets-menu')?.dataset.open === 'true'`;
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let i = 0; i < 8; i++) {
        const r = await s.rect('.lets-entity');
        if (!r) throw new Error('no companion');
        const d = Math.hypot(r.cx - b.pos.x, r.cy - b.pos.y);
        if (d < 8) break;
        await b.glide(r.cx, r.cy, Math.max(450, Math.min(1400, d * 4)));
        await sleep(250);
      }
      await sleep(200);
      await b.click();
      if (await s.waitFor(open, { timeout: 1500 })) return;
    }
    throw new Error('the companion menu did not open');
  }

  await need('the seeded memory', `document.querySelectorAll('#list-memory li').length > 5`, 15000);
  // the hand rests over the empty half of the persona card: Doto and his greeting sit there, off the traits
  await b.move(760, 300);

  if (LOOK) {
    await sleep(1800);
    await s.shot('den-look.png');
    const boxes = { cards: {}, entity: await box('.lets-entity'), bubble: await box('.lets-bubble'), name: await box('#p-name'), chatty: await box('#tr-chatty') };
    for (const k of ['persona', 'traits', 'likes', 'dislikes', 'nicknames', 'memory', 'skills', 'secrets', 'profile']) boxes.cards[k] = await box(`[data-section="${k}"]`);
    await b.glide(640, 420, 400);
    await scrollTo('#sec-memory', 68);
    await sleep(600);
    await s.shot('den-look-memory.png');
    boxes.memory = await box('#sec-memory');
    boxes.rows = await b.eval(`[...document.querySelectorAll('#list-memory li')].slice(0, 8).map((li) => { const r = li.getBoundingClientRect(); return Math.round(r.y) + '..' + Math.round(r.bottom) + '  ' + li.dataset.kind + ': ' + li.querySelector('.mem-text').textContent; })`);
    console.log(JSON.stringify(boxes, null, 1));
    claude.stop(); await b.close();
    return;
  }

  // ------------------------------------------------------------------------------------------ the take
  await sleep(900);                                    // his greeting is up for 6.5 s: the take keeps about five of them
  await rec.start();
  rec.mark('open');
  await sleep(1500);
  await bubbleClosed(9000);                            // the camera reads the persona, the traits and his greeting
  await sleep(500);
  rec.mark('settled');

  // 1. the chatty slider, down ---------------------------------------------------------------------------
  const chatty = await s.rect('#tr-chatty');
  const before = Number(await b.eval(`document.getElementById('tr-chatty').value`));
  const thumbX = (v) => chatty.x + 8 + v * (chatty.w - 16);
  await b.glide(thumbX(before), chatty.cy, 900);
  await sleep(300);
  const traitEv = claude.next('den.persona.set', { timeout: 8000, pred: (e) => !!e.data?.traits });
  rec.mark('trait.grab');
  await b.dragTo(thumbX(0.18), chatty.cy, 900);
  await pending('traits:chatty');
  rec.mark('trait.pending');
  // the hand drops off the row, straight down: Doto keeps up and to the right of the pointer, so a glide
  // up and to the right runs into him (he holds still and shows his name tag); every rest in this take is
  // reached going down, left or across
  await b.glide(thumbX(0.18) + 31, 668, 700);
  const ev1 = await traitEv;
  if (!ev1) throw new Error('no den.persona.set for the slider');
  await sleep(1100);                                   // pending, readable
  await apply({ action: 'set', traits: ev1.data.traits });
  await settled('traits:chatty');
  rec.mark('trait.applied', { traits: ev1.data.traits });
  await doto('Quieter. Got it.');
  await sleep(2500);
  rec.mark('trait.done');

  // 2. forget a stale memory line ------------------------------------------------------------------------
  const tsOf = (text) => b.eval(`(() => { const li = [...document.querySelectorAll('#list-memory li')].find((x) => x.querySelector('.mem-text')?.textContent === ${q(text)}); return li ? li.dataset.row.split(':')[1] : null; })()`);
  const staleTs = await tsOf(STALE);
  const treeTs = await tsOf('Prefers tree layouts over grids.');
  if (!staleTs || !treeTs) throw new Error('the seeded memory lines are not in the den');
  const staleKey = `memory:${staleTs}`;
  await b.glide(640, 690, 600);
  await scrollTo('#sec-memory', 68);
  rec.mark('memory.shown', { card: await box('#sec-memory'), stale: await box(rowSel(staleKey)) });
  await bubbleClosed(5000);                            // his last line is gone before the hand goes on
  await sleep(350);
  rec.mark('memory.point');
  await s.glideTo(`${rowSel(`memory:${treeTs}`)} .mem-text`, { ms: 600, fx: 0.32 });   // the line that says trees…
  await sleep(550);
  await s.glideTo(`${rowSel(staleKey)} .mem-text`, { ms: 450, fx: 0.36 });               // …and the one that says grids
  await sleep(600);
  const forgetEv = claude.next('den.memory.forget', { timeout: 8000 });
  await s.clickOn(`${rowSel(staleKey)} .x`, { ms: 550 });
  await pending(staleKey);
  rec.mark('memory.pending');
  await b.glide(760, 530, 650);
  const ev2 = await forgetEv;
  if (!ev2) throw new Error('no den.memory.forget');
  await sleep(1000);
  await apply({ action: 'unlearn', memory: [ev2.data.ts] });
  await need('the forgotten line to go', `!document.querySelector(${q(rowSel(staleKey))})`);
  rec.mark('memory.applied');
  const left = (await claude.tool('entity', { action: 'memory', n: 60 })).memory.length;
  const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen'];
  const word = (n) => WORDS[n] || String(n);
  const lc = (n) => word(n).toLowerCase();
  await doto(`Forgot that line. ${word(left)} left.`);
  await sleep(2400);
  rec.mark('memory.done', { left });

  // 3. "What do you know about me?" --------------------------------------------------------------------
  const askEv = claude.next('den.ask', { timeout: 8000 });
  await clickDoto();
  rec.mark('menu.open');
  await sleep(800);
  await s.glideTo({ js: `[...document.querySelectorAll('.lets-menu-item')].find((e) => e.textContent.includes('What do you know about me?'))` }, { ms: 600, fx: 0.35 });
  await sleep(450);
  await b.click();
  rec.mark('ask.picked');
  await b.glide(700, 660, 600);                        // off the lines the answer is about to light
  const ev3 = await askEv;
  if (!ev3) throw new Error('no den.ask');
  const E = ev3.data.entity;
  const cites = CITED.map((needle) => E.memory.find((m) => m.text.includes(needle))).filter(Boolean).sort((a, z) => z.ts - a.ts);
  if (cites.length !== CITED.length) throw new Error('a cited memory line is missing from den.ask');
  const secrets = (E.profile.secrets || []).length;
  await claude.send('entity.mood', { mood: 'thinking' });
  await sleep(500);
  await claude.stream([
    `${word(E.persona.likes.length)} likes, ${lc(E.persona.dislikes.length)} dislikes, ${lc(Object.keys(E.persona.nicknames).length)} nicknames, ${lc(E.memory.length)} memory lines, ${lc(E.skills.length)} skills, ${secrets ? lc(secrets) : 'none'} of seven secrets.`,
    'You plan in graph on Mondays and want trees, not grids.',
    'You want answers under five lines, and no renames without asking.',
  ].join('\n'), { cps: 120 });
  rec.mark('ask.answered');
  await claude.send('entity.mood', { mood: 'idle' });
  for (const m of cites) { await claude.send('den.highlight', { section: 'memory', id: m.ts, ttl: 6000 }); await sleep(220); }
  await need('the cited lines to glow', `document.querySelectorAll('#list-memory li.hl').length === ${cites.length}`, 3000);
  rec.mark('ask.cited', { lines: cites.map((m) => m.text) });
  await sleep(3200);
  rec.mark('ask.done');

  // 4. rename him ----------------------------------------------------------------------------------------
  await s.clickOn('#toolbar [data-act="chat"]', { ms: 900 });                                          // the hand folds the chat away
  await need('the chat to close', `document.querySelector('.lets-chat')?.dataset.open === 'false'`, 4000);
  rec.mark('chat.closed');
  await b.glide(640, 400, 600);
  await scrollTo('#sec-persona', 106);
  await still('#sec-persona');
  const nameEv = claude.next('den.persona.set', { timeout: 8000, pred: (e) => typeof e.data?.name === 'string' });
  await s.clickOn('#p-name', { ms: 800 });
  await need('the name editor', `document.querySelector('.inline-edit') === document.activeElement`, 3000);
  rec.mark('name.edit', { card: await box('#sec-persona') });
  await sleep(300);
  await b.glide(560, 300, 450);                        // the hand lets go of the name while the keys do the work
  await sleep(250);
  await b.type('Dottie', { cps: 14 });
  rec.mark('name.typed');
  await sleep(450);
  await b.key('Enter');
  await pending('persona:name');
  rec.mark('name.pending');
  const ev4 = await nameEv;
  if (!ev4) throw new Error('no den.persona.set for the name');
  await sleep(1100);
  await apply({ action: 'set', name: ev4.data.name });
  await settled('persona:name');
  rec.mark('name.applied', { name: ev4.data.name });
  await doto(`Call me ${ev4.data.name}.`);
  await sleep(2800);
  rec.mark('end');
}
