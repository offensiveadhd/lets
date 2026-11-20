// The graph board, one take: a hand draws two nodes and connects them, asks Claude in chat to fill in the
// rest, asks Doto what is missing around one node, and sends the board to Claude.
//   node promo/scenes/graph.mjs     -> footage/graph.mp4 + graph.json
//
// Claude's side follows lets-unique-graph/GUIDE.md: on a chat request it adds the nodes (ids of its own),
// connects them, lays the board out as a tree (the human asked for the tidy-up) and fits it; Doto says one
// line and the longer line goes to chat. On graph.ask it answers in chat in four lines, highlights the node
// it is talking about (one idea at a time), adds one node near the selection, pins one note, and Doto says
// one line in his voice. Send to Claude is the handoff: the engine saves the board and closes the window.
//
// Framing. The chat panel lies over the right 372 px of the window, and the board's fit (graph.focus, the
// F key) centres on the whole window, so the last column of a fitted tree sits under an open panel. The
// hand therefore folds the chat away after sending its question and again after reading the answer, as a
// person does, and every node the answer names is in the part of the board the panel never covers.
import { stage, sleep } from '../lib/rig.mjs';

const s = await stage({ unique: 'graph', name: 'graph', debugPort: Number(process.env.PROMO_DEBUG_PORT) || 9351 });
const { b, claude, rec } = s;

const fail = async (why) => { console.error(`  FAILED: ${why}`); await s.shot('graph-fail.png').catch(() => {}); await s.end(); process.exit(1); };
const must = async (what, js, o) => { if (!(await s.waitFor(js, o))) await fail(what); };

// ---- page expressions ----------------------------------------------------------------------------------
const AMBER = '#ffd166';
const CHAT_LEFT = 900;                                  // the open chat panel starts at x = 908
// the node with that label; a note carries its words in its body, so a node that holds the text also counts
const byLabel = (label) => `((L) => { const all = [...document.querySelectorAll('[data-node]')]; return all.find((g) => g.textContent.trim() === L) || all.find((g) => g.textContent.includes(L)); })(${JSON.stringify(label)})`;
const shapeOf = (label) => ({ js: `${byLabel(label)}?.querySelector('rect, path, polygon') || ${byLabel(label)}` });
const nodeId = (label) => b.eval(`${byLabel(label)}?.dataset.node || null`);
const hasNode = (label) => `!!${byLabel(label)}`;
const nodeCount = `document.querySelectorAll('[data-node]').length`;
const edgeCount = `document.querySelectorAll('[data-edge]').length`;
const editorOpen = `(() => { const e = document.querySelector('.editor'); return e && !e.hidden && document.activeElement === e; })()`;
const editorClosed = `(() => { const e = document.querySelector('.editor'); return !e || e.hidden; })()`;
const chatOpen = `(() => { const p = document.querySelector('.lets-chat'), t = document.querySelector('textarea.lets-chat-input'); return p?.dataset.open === 'true' && t && t.getBoundingClientRect().right <= innerWidth; })()`;
const chatClosed = `(() => { const p = document.querySelector('.lets-chat'); return p?.dataset.open === 'false' && getComputedStyle(p).visibility === 'hidden'; })()`;
const bubbleSays = (re) => `(() => { const u = document.querySelector('.lets-bubble'); return u?.dataset.open === 'true' && ${re}.test(u.textContent); })()`;
const chatSays = (re) => `${re}.test(document.querySelector('.lets-chat-list')?.textContent || '')`;
const COLLAPSE = { js: `document.querySelector('.lets-chat-head .lets-icon-btn')` };
/** Every node box lies inside the window, under the toolbar and (with `right`) left of that x. */
const inFrame = (labels, right = 1280) => `[${labels.map((l) => byLabel(l)).join(', ')}].every((g) => { const r = (g?.querySelector('rect, path, polygon') || g)?.getBoundingClientRect(); return r && r.left >= 0 && r.right <= ${right} && r.top >= 80 && r.bottom <= innerHeight; })`;

const mood = (m) => claude.send('entity.mood', { mood: m });

/** Waits until an element has stopped moving (an animation of the board, Doto catching up). */
async function rest(target, { timeout = 4000, every = 110 } = {}) {
  let last = null;
  for (const t0 = Date.now(); Date.now() - t0 < timeout;) {
    const r = await s.rect(target);
    if (r && last && Math.abs(r.x - last.x) < 0.6 && Math.abs(r.y - last.y) < 0.6 && Math.abs(r.w - last.w) < 0.6) return r;
    last = r;
    await sleep(every);
  }
  return last;
}

/**
 * A double-click the board cannot miss. The board has a double-tap rule of its own: two presses on the same
 * spot less than 380 ms apart by the page's clock (graph.js, onPointerDown). The driver's dblclick waits
 * for the page to answer each of its four events, and on a busy machine those answers take a frame each:
 * the first take ran at 9 frames a second, the two presses landed further apart than the rule allows, and
 * the board saw two single clicks and opened no editor. Here the four events go out on the hand's own
 * timing without waiting for the answers. If the board still saw two clicks, the hand double-clicks again.
 */
async function dblclick(done, { tries = 3 } = {}) {
  const ev = (type, clickCount, buttons) => b.send('Input.dispatchMouseEvent', { type, x: b.pos.x, y: b.pos.y, button: 'left', buttons, clickCount, modifiers: 0 });
  for (let i = 0; i < tries; i++) {
    const acks = [ev('mousePressed', 1, 1)];
    await sleep(45); acks.push(ev('mouseReleased', 1, 0));
    await sleep(65); acks.push(ev('mousePressed', 2, 1));
    await sleep(45); acks.push(ev('mouseReleased', 2, 0));
    await Promise.all(acks);
    if (await s.waitFor(done, { timeout: 1500, every: 50 })) return i + 1;
    await sleep(450);                                   // past the 380 ms, so the next press starts a new pair
  }
  return 0;
}

/** Double-click an empty spot, step off the label, type it, Enter. */
async function addByHand(x, y, label) {
  await b.glide(x, y, 650);
  await sleep(220);
  // Doto's bubble takes clicks: a press that lands on his greeting closes it and never reaches the board
  await must(`a clear spot for ${label}`, `!!document.elementFromPoint(${x}, ${y})?.closest('#svg')`, { timeout: 3000 });
  const before = await b.eval(nodeCount);
  const n = await dblclick(`${nodeCount} > ${before}`);
  if (!n) await fail(`the double-click for ${label}`);
  if (n > 1) console.warn(`  ${label}: the double-click took ${n} tries`);
  await must(`editor for ${label}`, editorOpen, { timeout: 5000 });
  await b.glide(x + 30, y + 125, 300);                  // off the label, and far enough down that Doto does not sit on the node
  await sleep(150);
  await b.type(label, { cps: 15 });
  await sleep(280);
  await b.key('Enter');
  await must(`node ${label}`, `${editorClosed} && ${hasNode(label)}`, { timeout: 5000 });
}

/** Doto follows the pointer and only takes a click once he lets himself be caught: aim, check, click. */
async function clickDoto() {
  for (let i = 0; i < 6; i++) {
    const r = await s.rect('.lets-entity');
    if (!r) await fail('no companion');
    await b.glide(r.cx, r.cy, i ? 280 : 650);
    await sleep(180);
    if (await b.eval(`!!document.elementFromPoint(${b.pos.x}, ${b.pos.y})?.closest('.lets-entity')`)) { await b.click(); return; }
  }
  await fail('Doto kept moving');
}

/** One chat message that arrives in several breaths (the same stream id), so the board can change between them. */
function chatAnswer() {
  const id = `ans${Date.now().toString(36)}`;
  let first = true;
  return async (text, { done = false, cps = 80, chunk = 14 } = {}) => {
    const parts = text.match(new RegExp(`[\\s\\S]{1,${chunk}}(?=\\s|$)|[\\s\\S]{1,${chunk}}`, 'g')) || [text];
    for (let i = 0; i < parts.length; i++) {
      await claude.tool('say', { text: parts[i], via: 'chat', to: s.windowId, stream_id: id, done: done && i === parts.length - 1, open_chat: first });
      first = false;
      await sleep((parts[i].length / cps) * 1000);
    }
  };
}

// ---- the take ------------------------------------------------------------------------------------------
// settled before the first frame: the pointer parked low on the right, so Doto and his greeting stand clear
// of the empty board's hint
await must('the greeting', bubbleSays('/Doto/'), { timeout: 8000 });
await b.glide(900, 600, 450);
await rest('.lets-entity');
await must('the greeting still up', bubbleSays('/Doto/'), { timeout: 500 });
await rec.start();
rec.mark('open');
await sleep(1600);

// 1. by hand: two nodes and a connection
rec.mark('draw.start');
await addByHand(250, 300, 'API gateway');
rec.mark('node1');
await sleep(350);
await addByHand(560, 300, 'Auth service');
rec.mark('node2');
await sleep(350);
const a = await s.rect(shapeOf('API gateway'));
const c = await s.rect(shapeOf('Auth service'));
if (!a || !c) await fail('node boxes');
// hover the first node so its dots show, then drag from the right-hand one to the second node
await b.glide(a.cx, a.cy, 550);
await sleep(300);
const port = await s.rect({ js: `${byLabel('API gateway')}?.querySelector('[data-port="r"]')` });
if (!port) await fail('no port');
await b.glide(port.cx, port.cy, 350);
await sleep(250);
rec.mark('connect.start');
await b.dragTo(c.cx, c.cy, 800);
await must('the first edge', `${edgeCount} >= 1`, { timeout: 4000 });
rec.mark('connected');
await sleep(750);
rec.mark('draw.end');

// 2. the person asks in chat and folds the panel away to watch; Claude joins in
const idGateway = await nodeId('API gateway');
const idAuth = await nodeId('Auth service');
await s.clickOn('.lets-chat-tab', { ms: 700 });
await must('chat open', chatOpen, { timeout: 4000 });
rec.mark('chat.open');
// opening the chat from its tab puts the caret in the box: the hand goes straight to the keys
await must('the caret in the chat box', `document.activeElement === document.querySelector('textarea.lets-chat-input')`, { timeout: 3000 });
await sleep(350);
rec.mark('chat.type');
const asked = claude.next('chat.message', { timeout: 15000 });
await b.type('Add the rest of the login flow and tidy it up', { cps: 18 });
await sleep(280);
await b.key('Enter');
if (!(await asked)) await fail('no chat.message');
rec.mark('chat.sent');
await sleep(500);
await s.clickOn(COLLAPSE, { ms: 550 });
await must('chat folded', chatClosed, { timeout: 3000 });
rec.mark('chat.closed');
await b.glide(560, 612, 650);                           // the hand rests under where the tree will be
await mood('thinking');
await sleep(550);
rec.mark('claude.start');
await claude.send([{ type: 'graph.node.add', data: { id: 'token_ok', label: 'Token valid?', kind: 'decision', near: idAuth } },
  { type: 'graph.edge.add', data: { from: idAuth, to: 'token_ok' } }]);
await must('Token valid?', hasNode('Token valid?'), { timeout: 5000 });
await sleep(600);
await claude.send([{ type: 'graph.node.add', data: { id: 'users_db', label: 'Users DB', kind: 'data', near: 'token_ok' } },
  { type: 'graph.edge.add', data: { from: 'token_ok', to: 'users_db', label: 'yes' } }]);
await must('Users DB', hasNode('Users DB'), { timeout: 5000 });
await sleep(600);
await claude.send([{ type: 'graph.node.add', data: { id: 'reject', label: 'Reject 401', kind: 'step', near: 'token_ok' } },
  { type: 'graph.edge.add', data: { from: 'token_ok', to: 'reject', label: 'no', kind: 'dashed' } }]);
await must('Reject 401', `${hasNode('Reject 401')} && ${edgeCount} >= 4`, { timeout: 5000 });
await rest(shapeOf('Reject 401'));
rec.mark('claude.added');
await sleep(650);
const before = await s.rect(shapeOf('Token valid?'));
await claude.send('graph.layout', { mode: 'tree', root: idGateway });
await must('the tree layout', `(() => { const r = (${shapeOf('Token valid?').js})?.getBoundingClientRect(); return r && (Math.abs(r.x - ${before.x}) > 2 || Math.abs(r.y - ${before.y}) > 2); })()`, { timeout: 4000 });
await rest(shapeOf('Reject 401'));
rec.mark('layout.tree');
await sleep(400);
await claude.send('graph.focus', { ids: [] });
await must('the fit', `document.querySelector('#zoom-label')?.textContent.trim() !== '100%'`, { timeout: 4000 });
await rest(shapeOf('Reject 401'));
const ALL = ['API gateway', 'Auth service', 'Token valid?', 'Users DB', 'Reject 401'];
await must('the whole tree in the frame', inFrame(ALL), { timeout: 3000 });
rec.mark('layout.done');
await sleep(900);
await claude.send([{ type: 'entity.mood', data: { mood: 'happy' } }, { type: 'entity.say', data: { text: 'Added three. Next?' } }]);
await must('Doto says it', bubbleSays('/Added three/'), { timeout: 4000 });
rec.mark('doto.said');
await sleep(1300);
await claude.stream('Added **Token valid?** with a *yes* path to **Users DB** and a *no* path to **Reject 401**, then laid it out as a tree.');
await must('the chat line', `${chatOpen} && ${chatSays('/laid it out as a tree/')}`, { timeout: 5000 });
rec.mark('chat.replied');
await sleep(1100);

// 3. select Auth service and ask Doto what is missing around it
await s.clickOn(shapeOf('Auth service'), { ms: 700 });
await must('Auth service selected', `document.querySelector('[data-node="${idAuth}"]')?.classList.contains('sel')`, { timeout: 3000 });
rec.mark('selected');
await sleep(450);
await clickDoto();
await must('Doto menu', `document.querySelector('.lets-menu')?.dataset.open === 'true' && [...document.querySelectorAll('.lets-menu-item')].some((e) => /missing around/.test(e.textContent))`, { timeout: 4000 });
rec.mark('menu.open');
await sleep(900);
const ask = claude.next('graph.ask', { timeout: 10000 });
await s.clickOn({ js: `[...document.querySelectorAll('.lets-menu-item')].find((e) => /missing around/.test(e.textContent))` }, { ms: 550 });
const ev = await ask;
if (!ev) await fail('no graph.ask');
const sel = ev.d?.selection || ev.data?.selection || [];
if (!sel.includes(idAuth)) await fail(`graph.ask without the selection: ${JSON.stringify(sel)}`);
await must('the question in chat', `${chatOpen} && ${chatSays('/What is missing around/')}`, { timeout: 4000 });
rec.mark('ask.sent');
await b.glide(690, 655, 600);                           // the hand rests clear of where the new node will land
await mood('thinking');
await sleep(600);
rec.mark('answer.start');
const say = chatAnswer();
await claude.send('graph.highlight', { ids: [idAuth], color: AMBER, ttl: 0 });
await say('Two gaps around **Auth service**:\n- A timeout fails the login outright. I added **Retry + backoff**.');
await claude.send([{ type: 'graph.node.add', data: { id: 'retry', label: 'Retry + backoff', kind: 'step', near: idAuth } },
  { type: 'graph.edge.add', data: { from: idAuth, to: 'retry', label: 'on timeout', kind: 'dashed' } }]);
await must('Retry + backoff', hasNode('Retry + backoff'), { timeout: 4000 });
await rest(shapeOf('Retry + backoff'));
await must('Retry + backoff beside the chat', inFrame(['Retry + backoff'], CHAT_LEFT), { timeout: 2000 });
rec.mark('answer.node');
await sleep(500);
await say('\n- Nothing limits failed attempts. I pinned a note on it.');
await claude.send('graph.annotate', { id: idAuth, text: 'Rate-limit failed logins.' });
await must('the note', hasNode('Rate-limit failed logins.'), { timeout: 4000 });
await rest(shapeOf('Rate-limit failed logins.'));
rec.mark('answer.note');
await sleep(500);
await claude.send([{ type: 'graph.highlight', data: { ids: [] } }, { type: 'graph.highlight', data: { ids: ['token_ok'], color: AMBER, ttl: 0 } }]);
await say('\n- **Token valid?** has no path for an expired token.', { done: true });
await sleep(350);
await claude.send([{ type: 'entity.mood', data: { mood: 'proud' } }, { type: 'entity.say', data: { text: 'Added *Retry + backoff*. Next?' } }]);
await must('Doto says it', bubbleSays('/Retry/'), { timeout: 4000 });
rec.mark('answer.done');
await sleep(1600);
// the answer is read: the person folds the chat away and looks at the whole board
await s.clickOn(COLLAPSE, { ms: 600 });
await must('chat folded', chatClosed, { timeout: 3000 });
await must('the whole board in the frame', inFrame([...ALL, 'Retry + backoff', 'Rate-limit failed logins.']), { timeout: 2000 });
rec.mark('board.full');
await b.glide(760, 640, 600);
await sleep(1000);
await claude.send('graph.highlight', { ids: [] });
await sleep(350);

// 4. Send to Claude: the handoff and the farewell
const exported = claude.next('graph.export', { timeout: 10000 });
await s.clickOn('#btn-send', { ms: 750 });
rec.mark('send');
if (!(await exported)) await fail('no graph.export');
await must('the farewell card', `(() => { const f = document.querySelector('.lets-farewell'); return f && f.offsetParent !== null && /Sent/.test(f.textContent); })()`, { timeout: 6000 });
rec.mark('farewell');
await b.glide(930, 612, 800).catch(() => {});
// the card says "This window is closing…" for 1.4 s and the page calls window.close(); a tab the page did not
// open itself stays, so the card then shows a hint and Keep working. Cuts for a README end before the hint.
await must('the hint', `/close itself/.test(document.querySelector('.lets-farewell-sub')?.textContent || '')`, { timeout: 6000 });
rec.mark('farewell.hint');
await sleep(1000);
rec.mark('end');
await sleep(300);
await s.end();
process.exit(0);
