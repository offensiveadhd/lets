// cocode: talk in code. One take: the hand types four lines of an invented language, Claude offers the next
// two as a ghost and Tab makes them solid, Claude prepares the real program in the Build pane, Build & run
// asks "Run on this machine?" on a fresh home and the engine's own runner executes the build, one line reaches
// outside the sandbox and gets its diamond, and the code goes to Claude with an intent picked.
//
//   node promo/scenes/cocode.mjs                        the take -> footage/cocode.mp4 + cocode.json
//   node promo/scenes/cocode.mjs --look                 no recording: the same story, a PNG at the main marks and
//                                                       the boxes the cuts crop to (out/shots/cocode-NN-<mark>.png)
//   node promo/scenes/cocode.mjs --look --until=ghost.shown     stop the look after that mark
//
// Claude's side follows lets-unique-cocode/GUIDE.md: seeds and one Doto line for an empty editor; one
// cocode.suggest for the settled change, in the human's dialect and never a `say` (the ghost is the answer);
// cocode.build (building, then ready) once the purpose is clear, with one Doto line; one Doto line after
// cocode.ran; a reach written as claude.<verb>(...) in the build with a note that Claude performs it; and after
// the handoff nothing is sent to the window, the session only gets its label.
//
// Nothing about the run is scripted: the build is run by the engine's runner (POST /lip/run) after the consent
// card, and the scene fails if the Output pane does not hold what that program prints. Python is used when
// GET /lip/run/info reports it runnable on this machine, JavaScript otherwise; with neither, the story ends at
// the build and says so.
import { stage, sleep } from '../lib/rig.mjs';

const LOOK = process.argv.includes('--look');
const UNTIL = (process.argv.find((a) => a.startsWith('--until=')) || '').slice(8) || null;

const s = await stage({ unique: 'cocode', name: 'cocode', debugPort: Number(process.env.PROMO_DEBUG_PORT) || 9353 });
const { b, claude, rec, host } = s;

// ------------------------------------------------------------------------------------------ the program
// An invented language, short enough to read in a GIF. No line starts with a word the window's local
// predictor or its language detector knows (if, for, else…), so the chip stays on `pseudo` and the only
// ghost in the take is Claude's.
const TYPED = [
  'crew = ada, grace, linus',
  'each mate in crew:',
  'when mate is grace:',                 // the editor indents after a colon by itself
  'shout "captain on deck"',
];
const TEXT4 = 'crew = ada, grace, linus\neach mate in crew:\n  when mate is grace:\n    shout "captain on deck"';
const GHOST = 'otherwise:\n    shout "ahoy, " + mate';            // the caret sits after the indentation: the rest of that line, then the next
const TEXT6 = `${TEXT4}\n  otherwise:\n    shout "ahoy, " + mate`;
const REACH = 'ping: example.com';
const TEXT7 = `${TEXT6}\n${REACH}`;
const STDOUT = 'ahoy, ada\ncaptain on deck\nahoy, linus';

const BUILDS = {
  python: {
    name: 'Python', file: 'crew.py',
    code: 'crew = ["ada", "grace", "linus"]\nfor mate in crew:\n    if mate == "grace":\n        print("captain on deck")\n    else:\n        print("ahoy, " + mate)',
    reach: 'claude.ping("example.com")',
  },
  javascript: {
    name: 'JavaScript', file: 'crew.js',
    code: 'const crew = ["ada", "grace", "linus"];\nfor (const mate of crew) {\n  if (mate === "grace") console.log("captain on deck");\n  else console.log("ahoy, " + mate);\n}',
    reach: 'claude.ping("example.com");',
  },
};
const SEEDS = [
  { id: 'welcome', label: 'Welcome script', hint: 'pseudo-code', text: 'for each user in users:\n  if user is new:\n    send welcome' },
  { id: 'fizz', label: 'FizzBuzz to 15', lang: 'python', text: 'for n in range(1, 16):\n    print("Fizz" * (n % 3 == 0) + "Buzz" * (n % 5 == 0) or n)' },
  { id: 'up', label: 'Is the site up?', hint: 'reaches out', text: 'ping example.com' },
];
const REST = { x: 610, y: 600 };         // where the pointer waits while the hand is on the keyboard: low in the editor, clear of the text

// ---------------------------------------------------------------------------------------------- helpers
const SHOTS = ['seeds', 'type.end', 'ghost.shown', 'build.ready', 'consent.card', 'ran.said', 'reach.note', 'reach.build', 'farewell'];
async function close(code) {
  if (LOOK) { claude.stop(); await b.close(); await host.stop(); } else await s.end();
  process.exit(code);
}
const fail = async (why) => { console.error(`  FAILED: ${why}`); await s.shot('cocode-fail.png').catch(() => {}); await close(1); };
const must = async (what, js, o) => { const v = await s.waitFor(js, o); if (!v) await fail(what); return v; };
/** A mark in the take; in a look, a PNG of the main ones and a stop at --until. */
async function mark(what, extra = {}) {
  if (!LOOK) return rec.mark(what, extra);
  console.log(`  look  ${what}${Object.keys(extra).length ? '  ' + JSON.stringify(extra) : ''}`);
  if (SHOTS.includes(what)) { await sleep(400); await s.shot(`cocode-${String(SHOTS.indexOf(what) + 1).padStart(2, '0')}-${what}.png`); }
  if (what === UNTIL) await close(0);
  return 0;
}
/** The boxes the cuts crop to, printed in a look. */
async function boxes(...sel) {
  if (!LOOK) return;
  for (const q of sel) { const r = await s.rect(q).catch(() => null); console.log(`  box   ${typeof q === 'string' ? q : JSON.stringify(q)}  ${r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}` : 'none'}`); }
}

// The rig's b.key() takes a character's code point for its virtual key, which for punctuation is another key
// (a full stop is Delete, a quote is PageDown). The hand here types what a US keyboard sends.
const KEYS = {
  ' ': ['Space', 32, 0], '=': ['Equal', 187, 0], '+': ['Equal', 187, 8], ',': ['Comma', 188, 0], '.': ['Period', 190, 0],
  ':': ['Semicolon', 186, 8], '"': ['Quote', 222, 8],
};
async function press(ch) {
  const k = KEYS[ch];
  if (!k) { if (!/^[a-z0-9]$/.test(ch)) throw new Error(`no key for "${ch}"`); return b.key(ch); }
  const ev = { key: ch, code: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1], modifiers: k[2] };
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', ...ev, text: ch, unmodifiedText: ch });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
}
// the same unevenness in every take
let seed = 20261119;
const uneven = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
async function type(text, { cps = 15, jitter = 0.3 } = {}) {
  for (const ch of text) { await press(ch); await sleep((1000 / cps) * (1 + (uneven() * 2 - 1) * jitter)); }
}

const value = () => b.eval(`document.getElementById('code').value`);
const line = (n) => ({ js: `document.querySelector('#layer .l[data-l="${n}"]')` });
/** A spot just past the end of a line's text: a click there puts the caret at the end of that line. */
const endOf = (n) => ({ js: `(() => { const l = document.querySelector('#layer .l[data-l="${n}"]'); if (!l) return null; const r = l.getBoundingClientRect(); const t = document.createRange(); t.selectNodeContents(l); const e = t.getBoundingClientRect(); return { x: e.right + 8, y: r.y, width: 24, height: r.height }; })()` });
/** The next settled change by the human whose text is exactly `text`. */
const changed = (text) => claude.next('cocode.changed', { timeout: 8000, pred: (ev) => ev.data?.by === 'human' && ev.data.text === text });
const doto = (text, mood) => claude.send('entity.say', { text, ...(mood ? { mood } : {}) });
const mood = (m) => claude.send('entity.mood', { mood: m });

/** Picks an intent the way a hand does: a click on the select, the arrow keys, Enter. */
async function pickIntent(want) {
  const steps = await b.eval(`[...document.getElementById('intent').options].findIndex((o) => o.value === ${JSON.stringify(want)}) - document.getElementById('intent').selectedIndex`);
  await s.clickOn('#intent', { ms: 850 });
  await sleep(350);
  for (let i = 0; i < steps; i++) { await b.key('ArrowDown'); await sleep(240); }
  await b.key('Enter');
  await must(`the intent did not become "${want}"`, `document.getElementById('intent').value === ${JSON.stringify(want)}`, { timeout: 2500 });
}

// ------------------------------------------------------------------------------------- before the camera
await must('the window did not connect', `document.getElementById('status-dot').dataset.status === 'open'`, { timeout: 8000 });

// what this machine really runs, from the engine itself
const info = await fetch(`${host.origin}/lip/run/info?w=${encodeURIComponent(s.windowId)}`, { headers: { 'x-lets-token': host.token } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const runsHere = (l) => !!(info && info.enabled && info.languages?.[l]?.ok && (info.exec || []).includes(l));
const LANG = runsHere('python') ? 'python' : runsHere('javascript') ? 'javascript' : null;
const B = BUILDS[LANG || 'python'];
console.log(`  runner: ${info ? Object.entries(info.languages || {}).map(([k, v]) => `${k} ${v.ok ? v.version : 'no'}`).join(', ') : 'none'}; allowed ${info?.allowed}; the build is ${B.name}${LANG ? '' : ' and nothing runs here: the story ends at the build'}`);
if (LANG && info.allowed) await fail('the throwaway home already allows cocode, so there is no consent card to show');
if (LANG) await must('the runner badge did not ask for an OK', `document.getElementById('runner-badge').dataset.state === 'ask'`, { timeout: 6000 });

await b.move(REST.x, REST.y);
// the shell's own first-run greeting: Doto introduces himself 0.7 s after the window loads, for 6.5 s
await must('Doto did not greet', `document.querySelector('.lets-bubble')?.dataset.open === 'true' && /Doto/.test(document.querySelector('.lets-bubble').textContent)`, { timeout: 6000 });

// --------------------------------------------------------------------------------- 1. the empty editor
if (!LOOK) await rec.start();
await mark('open');
await sleep(1300);
// Claude, on an empty editor: starting points and one line
await claude.send('cocode.seed', { items: SEEDS });
await doto('Empty page. Start anywhere.');
await must('the seeds did not show', `document.querySelectorAll('#seeds .seed').length === ${SEEDS.length}`, { timeout: 4000 });
await mark('seeds');
await boxes('#topbar', '#editor', '#scroller', '#gutter', '#rail', '#pane-build', '#pane-output', '#btn-run', '#intent', '#btn-send', '.lets-entity', '.lets-bubble');
await sleep(2000);

// ------------------------------------------------------------------- 2. four lines of a made-up language
await s.clickOn(line(1), { ms: 800, fx: 0, dx: 10 });
await must('the editor did not take the focus', `document.activeElement?.id === 'code'`, { timeout: 2000 });
await b.glide(REST.x, REST.y, 650);
await sleep(300);
await mark('type.start');
for (let i = 0; i < TYPED.length; i++) {
  if (i) { await b.key('Enter'); await sleep(330); }
  await mark(`type.l${i + 1}`);
  await type(TYPED[i]);
}
if ((await value()) !== TEXT4) await fail(`typed four lines, the editor holds ${JSON.stringify(await value())}`);
if ((await b.eval(`document.getElementById('lang-name').textContent`)) !== 'pseudo') await fail('the chip left pseudo');
// a new line, one step out: the caret waits where the other branch would start
const waited = changed(`${TEXT4}\n  `);
await sleep(300);
await b.key('Enter');
await sleep(280);
await b.key('Tab', { shift: true });
await mark('type.end');

// --------------------------------------------------------------------------- 3. the ghost, and Tab
const ch = await waited;
if (!ch) await fail(`no cocode.changed for the typed text (the editor holds ${JSON.stringify(await value())})`);
const reel0 = Date.now();
await mark('reel.start', { rev: ch.data.rev });
await sleep(750);                                             // Claude reads it
await claude.send('cocode.suggest', { rev: ch.data.rev, text: GHOST });
await must('the ghost did not show', `document.getElementById('st-ghost').textContent === 'claude' && !!document.querySelector('#layer .ghost') && !document.getElementById('ghost-block').hidden`, { timeout: 4000 });
await mark('ghost.shown');
await boxes(line(1), line(5), '#ghost-block', '#statusline');
await sleep(2200);
const settled = changed(TEXT6);
const accepted = claude.next('cocode.ghost.accept', { timeout: 6000 });
await b.key('Tab');
await must('Tab did not accept the ghost', `document.getElementById('code').value === ${JSON.stringify(TEXT6)} && !document.querySelector('#layer .ghost')`, { timeout: 3000 });
await mark('ghost.accept');
const acc = await accepted;
if (!acc || acc.data.source !== 'claude' || acc.data.partial) await fail(`cocode.ghost.accept said ${JSON.stringify(acc?.data)}`);

// ------------------------------------------------------------------------------------- 4. build ahead
const ch2 = await settled;
if (!ch2) await fail('no cocode.changed after the accept');
await sleep(450);
await claude.send([{ type: 'entity.mood', data: { mood: 'thinking' } }, { type: 'cocode.build', data: { rev: ch2.data.rev, lang: LANG || 'python', status: 'building' } }]);
await must('the Build pane did not say building', `document.getElementById('build-pill').dataset.state === 'building' && document.getElementById('btn-run').dataset.state === 'building'`, { timeout: 3000 });
await mark('build.building');
await sleep(1300);
await claude.send('cocode.build', { rev: ch2.data.rev, lang: LANG || 'python', status: 'ready', file: B.file, code: B.code });
await must('the build did not land', `document.getElementById('build-pill').dataset.state === 'ready' && !document.getElementById('build-code').hidden && document.getElementById('build-code').textContent === ${JSON.stringify(B.code)}`, { timeout: 3000 });
await mark('build.ready');
await claude.send([{ type: 'entity.mood', data: { mood: 'idle' } }, { type: 'entity.say', data: { text: `Built it. ${B.name}, ${B.code.split('\n').length} lines.` } }]);
await boxes('#pane-build', '#build-code', '.lets-entity', '.lets-bubble');
// the seven seconds a family reel takes: from the settled text to the build, read
await sleep(Math.max(1200, 7000 - (Date.now() - reel0)));
await mark('reel.end');
await sleep(900);

if (!LANG) {                                                   // no runner on this machine: the story ends at the build
  await mark('end');
  await close(0);
}

// ------------------------------------------------------------------- 5. Build & run, on this machine
const ranEvent = claude.next('cocode.ran', { timeout: 40000 });
await s.clickOn('#btn-run', { ms: 850, fx: 0.74 });           // the right end of the button: the wheel at its left stays in view
await mark('run.click');
await must('the consent card did not open', `!document.getElementById('consent').hidden && /Run on this machine/.test(document.getElementById('consent-title').textContent) && document.querySelectorAll('#consent-body li').length > 0`, { timeout: 4000 });
await mark('consent.card');
await boxes('#consent-card', '#consent-yes', '#runner-badge');
await s.glideTo('#consent-yes', { ms: 900 });
await sleep(2700);                                            // long enough to read the card
await b.click();
await mark('consent.allow');
const away = b.glide(REST.x, REST.y, 700);
await must('the run did not end with exit 0', `document.getElementById('btn-run').dataset.state === 'done' && document.querySelector('#runs .run .pill')?.textContent === 'exit 0'`, { timeout: 30000 });
await mark('run.done');
await away;
// what shows is what the runner printed
const shown = (await b.eval(`document.querySelector('#runs .run .out-std')?.textContent || ''`)).replace(/\r/g, '').trim();
if (shown !== STDOUT) await fail(`the Output pane holds ${JSON.stringify(shown)}`);
const ran = await ranEvent;
if (!ran || ran.data.exit !== 0 || ran.data.lang !== LANG || !ran.data.sandbox) await fail(`cocode.ran said ${JSON.stringify(ran?.data)}`);
if ((await b.eval(`document.getElementById('runner-badge').dataset.state`)) !== 'on') await fail('the runner badge did not turn on');
await boxes('#pane-output', '#runs .run', '#runner-badge', '.lets-entity');
await sleep(450);
await doto(`Ran it. Exit 0, ${ran.data.stdout.replace(/\r/g, '').trim().split('\n').length} lines.`, 'proud');
await mark('ran.said', { ms: ran.data.ms, sandbox: ran.data.sandbox });
await sleep(2600);

// --------------------------------------------------------------- 6. one line that leaves the sandbox
await s.clickOn(endOf(6), { ms: 850 });
await must('the caret is not at the end of the text', `(() => { const c = document.getElementById('code'); return document.activeElement === c && c.selectionStart === c.value.length && c.selectionEnd === c.value.length; })()`, { timeout: 2000 });
await mark('reach.click');
await sleep(350);
const reached = changed(TEXT7);
await b.key('Enter');
await sleep(160);
await b.key('Home', { shift: true });                         // the indentation the editor gave the new line: the first letter replaces it
await sleep(200);
await type(REACH, { cps: 14 });
if ((await value()) !== TEXT7) await fail(`typed the reach line, the editor holds ${JSON.stringify(await value())}`);
await mark('reach.typed');
await must('the reach did not get its diamond and its count', `document.querySelector('#gutter .gn[data-line="7"]')?.dataset.kind === 'reach' && !document.getElementById('st-reach-wrap').hidden && document.getElementById('st-reach').textContent === '1'`, { timeout: 4000 });
await mark('reach.marked');
await sleep(800);
await s.glideTo('#gutter .gn[data-line="7"]', { ms: 750, fx: 0.6, fy: 0.6 });
await must('the note on the diamond did not open', `!document.getElementById('note-pop').hidden && /ping example\\.com/.test(document.getElementById('note-pop').textContent) && /reaches the network/.test(document.getElementById('note-pop').textContent)`, { timeout: 3000 });
await mark('reach.note');
await boxes('#note-pop', '#gutter .gn[data-line="7"]', '#st-reach-wrap');
await sleep(2300);
// Claude builds as always; the reach stays, written as claude.<verb>(...), and the note says who performs it
const ch3 = await reached;
if (!ch3) await fail('no cocode.changed for the reach line');
const withReach = `${B.code}\n${B.reach}`;
await claude.send([{ type: 'entity.mood', data: { mood: 'thinking' } }, { type: 'cocode.build', data: { rev: ch3.data.rev, lang: LANG, status: 'building' } }]);
await sleep(1000);
await claude.send('cocode.build', { rev: ch3.data.rev, lang: LANG, status: 'ready', file: B.file, code: withReach, notes: 'Line 7 reaches the network. I do the ping for real when you Run.' });
await must('the build with the reach did not land', `document.getElementById('build-pill').dataset.state === 'ready' && document.getElementById('build-code').textContent === ${JSON.stringify(withReach)} && !document.getElementById('build-notes').hidden`, { timeout: 3000 });
await mark('reach.build');
await claude.send([{ type: 'entity.mood', data: { mood: 'idle' } }, { type: 'entity.say', data: { text: `Built it. ${withReach.split('\n').length} lines, one reach.` } }]);
await sleep(2500);

// ------------------------------------------------------------------------------- 7. Send to Claude
await pickIntent('do');
await mark('intent.picked');
await sleep(700);
const exported = claude.next('cocode.export', { timeout: 10000 });
await s.clickOn('#btn-send', { ms: 600 });
await mark('send');
const ex = await exported;
if (!ex || ex.data.intent !== 'do' || ex.data.text !== TEXT7) await fail(`cocode.export said ${JSON.stringify({ intent: ex?.data?.intent, text: ex?.data?.text })}`);
await must('no farewell card', `document.querySelector('.lets-farewell') && document.querySelector('.lets-farewell').offsetParent !== null`, { timeout: 6000 });
await mark('farewell');
// a handoff: nothing more goes to the window; the saved session gets its label
if (ex.data.session?.id) await claude.tool('sessions', { action: 'label', unique: 'cocode', id: ex.data.session.id, label: 'crew roll call with a ping' }).catch(() => {});
await b.glide(REST.x + 330, REST.y + 40, 900).catch(() => {});
await sleep(2400);
await mark('end');
await close(0);
