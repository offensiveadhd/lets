/**
 * Native windows (docs/NATIVE.md): a unique's `native.entry` script runs in a
 * `node:vm` context inside the host and draws into a pane of Claude Code's
 * own, displayed by the lets-native mod. The mod polls trees and posts
 * actions; this module owns the contexts, the trees and the native shell
 * (companion line, chat, components, toasts, farewell) drawn around a view.
 *
 * Nothing of the host realm is handed to the view: the `lets` API, `console`
 * and `ctx` are built inside the context and talk back through a bounded
 * queue of strings (`__out`) the host drains after every call. Every call
 * into the view runs through a compiled trampoline with a timeout, and every
 * string that comes back is size-checked before it is parsed.
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { rid } from './ids.mjs';

const LIP = 1;
export const NATIVE_VERSION = 1;          // the view API this host speaks (ctx.native in the view)
const HANDLER_MS = 2000;
const MAX_STATE = 1 << 20;                // state, and any string a trampoline hands back
const MAX_TREE = 96 * 1024;
const MAX_NODES = 5000;
const MAX_DEPTH = 24;
const MAX_SVG = 120000;
const MAX_TEXT = 100000;
const CHAT_LINES = 8;
const CHAT_STREAMS = 16;
const TOASTS = 3;
const TOAST_MS = 8000;
const FORGET_MS = 10_000;                 // a closed window is listed to the poller this long, then dropped
const FAREWELL_MIN_MS = 2500;             // the farewell card must survive a poll interval to be seen
const FAREWELL = { handoff: 'Sent. See you in Claude Code ✦', idle: 'All quiet here, so this window is closing. See you in Claude Code ✦', claude: 'Back to Claude Code. See you there ✦' };
const MOODS = new Set(['idle', 'happy', 'curious', 'thinking', 'busy', 'proud', 'sleepy', 'alert']);
const MOOD_GLYPH = { idle: '◉', happy: '◉‿', curious: '◉?', thinking: '◉…', busy: '◉⚙', proud: '◉★', sleepy: '◉z', alert: '◉!' };
const REACT_GLYPH = { wink: '😉', cheer: '🎉', nod: '👍', 'shake-no': '👎', sparkle: '✨', dizzy: '💫', whoa: '😮', startled: '😲', gasp: '😧', oops: '😅', blush: '😊', boop: '•', yawn: '🥱', peek: '👀', wave: '👋', spin: '🔄', dance: '🕺', disco: '🪩' };
const LEVELS = new Set(['info', 'ok', 'warn', 'error']);
const COMPONENT_TYPES = new Set(['note', 'options', 'slider', 'toggle', 'form', 'image-drop', 'progress', 'code']);

/** Props each element may carry in a tree (the desktop surface's table; docs/NATIVE.md §3). */
export const ELEMENT_PROPS = {
  Box: ['key', 'flexDirection', 'flexGrow', 'flexShrink', 'flexWrap', 'alignItems', 'alignSelf', 'justifyContent', 'gap', 'columnGap', 'rowGap', 'width', 'height', 'minWidth', 'minHeight', 'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderStyle', 'borderColor', 'borderDimColor', 'backgroundColor', 'overflow', 'display'],
  Text: ['color', 'backgroundColor', 'dimColor', 'bold', 'italic', 'underline', 'strikethrough', 'inverse', 'wrap'],
  Button: ['key', 'label', 'variant', 'dimColor', 'plain'],
  Input: ['key', 'label', 'placeholder', 'value', 'submitLabel'],
  Select: ['key', 'label', 'options', 'value'],
  Svg: ['source', 'alt', 'width', 'height', 'isInteractive'],
  Markdown: ['text', 'dimColor'],
  Code: ['source', 'language', 'startLine', 'wrap', 'format'],
  Link: ['href', 'label'],
};
const WITH_CHILDREN = new Set(['Box', 'Text', 'Button']);
const ACTIONABLE = new Set(['Button', 'Input', 'Select']);
const KINDS = new Set(['press', 'submit', 'select']);
const NUMERIC = { Svg: new Set(['width', 'height']), Code: new Set(['startLine']), Box: new Set(['flexGrow', 'flexShrink', 'gap', 'columnGap', 'rowGap', 'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']) };

// ---- the context side: built inside the vm, no host function crosses ---------------------------

const BOOT = `
var __out = [];
var __outBytes = 0;
var __dropped = 0;
var __spec = null;
var __state = undefined;
var __facts = JSON.parse(__json); __json = undefined;
var __snap = undefined;
function __queue(item) {
  var n = 0;
  for (var i = 0; i < item.length; i++) n += item[i].length;
  if (__out.length >= 1000 || __outBytes + n > 1048576) { __dropped++; return; }
  __outBytes += n;
  __out.push(item);
}
function __data(d) { var s = JSON.stringify(d === undefined ? {} : d); return typeof s === 'string' ? s : '{}'; }
var __ctx = {
  unique: __facts.unique, windowId: __facts.windowId, version: __facts.version, native: __facts.native,
  args: __facts.args, persona: __facts.persona, viewport: __facts.viewport,
  emit: function (type, data) { __queue(['emit', String(type), __data(data)]); },
  reply: function (type, data) { __queue(['reply', String(type), __data(data)]); },
  toast: function (text, level) { __queue(['toast', String(text).slice(0, 300), level == null ? 'info' : String(level)]); },
  chat: function (text) { __queue(['chat', String(text).slice(0, 4000), '']); },
  after: function (ms) { __queue(['after', String(Math.max(100, Math.min(60000, Number(ms) || 0))), '']); },
  id: function (prefix) { return String(prefix == null ? '' : prefix) + Math.random().toString(36).slice(2, 7).padEnd(5, '0'); },
  now: function () { return Date.now(); },
};
var console = (function () {
  function at(level) { return function () { var parts = []; for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; parts.push(typeof a === 'string' ? a : (function () { try { return JSON.stringify(a); } catch (e) { return String(a); } })()); } __queue(['log', level, parts.join(' ').slice(0, 2000)]); }; }
  return { log: at('log'), info: at('log'), debug: at('log'), warn: at('warn'), error: at('error') };
})();
var __ui = (function () {
  function el(t, p, c) { return { t: t, p: p && typeof p === 'object' ? p : {}, c: c }; }
  function kids(args, from) { var out = []; for (var i = from; i < args.length; i++) { var k = args[i]; if (k == null || k === false) continue; if (Array.isArray(k)) { for (var j = 0; j < k.length; j++) if (k[j] != null && k[j] !== false) out.push(k[j]); } else out.push(k); } return out; }
  function box(p) { return el('Box', p, kids(arguments, 1)); }
  function row(p) { return el('Box', Object.assign({ flexDirection: 'row' }, p || {}), kids(arguments, 1)); }
  function col(p) { return el('Box', Object.assign({ flexDirection: 'column' }, p || {}), kids(arguments, 1)); }
  function text(p) { if (p === null || typeof p !== 'object') return el('Text', {}, kids(arguments, 0)); return el('Text', p, kids(arguments, 1)); }
  function button(p) { return el('Button', p, kids(arguments, 1)); }
  function input(p) { return el('Input', p, []); }
  function select(p) { return el('Select', p, []); }
  function svg(p) { return el('Svg', p, []); }
  function markdown(t, p) { return el('Markdown', Object.assign({}, p || {}, { text: String(t == null ? '' : t) }), []); }
  function code(p) { return el('Code', p, []); }
  function link(p) { return el('Link', p, []); }
  return { box: box, row: row, col: col, text: text, button: button, input: input, select: select, svg: svg, markdown: markdown, code: code, link: link, el: el };
})();
function __sync(ret) { if (ret && typeof ret.then === 'function') throw new Error('handlers must be synchronous: no async functions, no Promises'); return ret; }
var lets = {
  native: function (spec) {
    if (__spec) throw new Error('lets.native() was called twice');
    if (!spec || typeof spec.init !== 'function' || typeof spec.render !== 'function') throw new Error('lets.native() needs init() and render()');
    __spec = spec;
  },
};
`;
const S = {
  boot: new vm.Script(BOOT, { filename: 'lets-native-boot.js' }),
  parse: new vm.Script('__a = JSON.parse(__json); __json = undefined;', { filename: 'lets-native-parse.js' }),
  init: new vm.Script('__state = __sync(__spec.init(__ctx)); __r = JSON.stringify(__state).length; __x = typeof __spec.export === "function";', { filename: 'lets-native-init.js' }),
  render: new vm.Script('__r = JSON.stringify(__sync(__spec.render(__state, __ui, __ctx)));', { filename: 'lets-native-render.js' }),
  // a handler runs against a snapshot: whatever it did before throwing (or being stopped) is undone by S.restore
  on: new vm.Script('(function () { var h = __spec.on && (__spec.on[__a[0]] || __spec.on["*"]); if (typeof h !== "function") { __r = -1; return; } __snap = JSON.stringify(__state); var ret = __sync(h.call(__spec, __state, __a[1], __ctx, __a[0])); if (ret !== undefined) __state = ret; __r = JSON.stringify(__state).length; })();', { filename: 'lets-native-on.js' }),
  action: new vm.Script('(function () { if (typeof __spec.action !== "function") { __r = -1; return; } __snap = JSON.stringify(__state); var ret = __sync(__spec.action(__state, __a, __ctx)); if (ret !== undefined) __state = ret; __r = JSON.stringify(__state).length; })();', { filename: 'lets-native-action.js' }),
  restore: new vm.Script('if (typeof __snap === "string") { try { __state = JSON.parse(__snap); } catch (e) {} } __snap = undefined;', { filename: 'lets-native-restore.js' }),
  export: new vm.Script('__r = typeof __spec.export === "function" ? JSON.stringify(__sync(__spec.export(__state, __ctx))) : "null";', { filename: 'lets-native-export.js' }),
  destroy: new vm.Script('if (typeof __spec.destroy === "function") __sync(__spec.destroy(__state, __ctx)); __r = 0;', { filename: 'lets-native-destroy.js' }),
  viewport: new vm.Script('__ctx.viewport = JSON.parse(__json); __json = undefined;', { filename: 'lets-native-viewport.js' }),
  drain: new vm.Script('__r = JSON.stringify(__out); __out.length = 0; __outBytes = 0; __d = __dropped; __dropped = 0;', { filename: 'lets-native-drain.js' }),
};

// ---- helpers ---------------------------------------------------------------------------------------

const clean = (s, max = MAX_TEXT) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
const safeId = (s, max = 64) => String(s ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, max);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const n = (t, p = {}, ...c) => ({ t, p, c: c.flat().filter((x) => x != null && x !== false) });
const row = (p, ...c) => n('Box', { flexDirection: 'row', ...p }, ...c);
const col = (p, ...c) => n('Box', { flexDirection: 'column', ...p }, ...c);
const txt = (p, ...c) => (typeof p === 'string' ? n('Text', {}, p, ...c) : n('Text', p, ...c));
const button = (key, label, extra = {}) => n('Button', { key, label, ...extra });
const mdLite = (s) => clean(s, 4000);

/** The unique's domain of a message type. */
const domainOf = (type) => String(type).split('.')[0];

/**
 * Whether an SVG document may be handed to the pane. A short allow-list over
 * what can reach out of a picture: no script or foreign content, no event
 * handlers (also none set through SMIL), no character references (they hide
 * all of the above), and every `href`, `url()` or `src` points inside the
 * document (`#id`) or at inline image data. Returns the reason to refuse, or null.
 */
export function svgProblem(source) {
  const s = String(source);
  if (!/^\s*<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return 'not an <svg> document';
  if (s.length > MAX_SVG) return `over ${MAX_SVG} characters`;
  if (/&#|&[a-z]+;/i.test(s.replace(/&(amp|lt|gt|quot|apos);/gi, ''))) return 'character references';
  if (/<!(DOCTYPE|ENTITY)|<\?/i.test(s)) return 'doctype, entity or processing instruction';
  if (/<\s*(script|foreignObject|iframe|embed|object|audio|video|animation|handler|listener)\b/i.test(s)) return 'script or foreign content';
  // the rest looks at markup and attributes, not at what a <text> says ("data: users" is a fine label);
  // a <style> block is text that still reaches the renderer, so with one present everything is scanned
  const m = /<\s*style\b/i.test(s) ? s : s.replace(/>([^<]*)</g, '><');
  if (/\bon[a-z]+\s*=/i.test(m)) return 'an event handler attribute';
  if (/\battributeName\s*=\s*["']?\s*on/i.test(m)) return 'an animated event handler';
  if (/javascript:|vbscript:|data:(?!image\/(png|jpeg|gif|webp|svg\+xml)[;,])/i.test(m)) return 'a script or data URL';
  for (const x of m.matchAll(/\b(?:xlink:)?(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const v = (x[1] ?? x[2] ?? x[3] ?? '').trim();
    if (!(v.startsWith('#') || /^data:image\//i.test(v))) return `an external reference (${v.slice(0, 40)})`;
  }
  for (const x of m.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi)) {
    const v = (x[1] ?? x[2] ?? x[3] ?? '').trim();
    if (!v.startsWith('#')) return `url() outside the document (${v.slice(0, 40)})`;
  }
  if (/@import|expression\s*\(/i.test(m)) return 'css import or expression';
  return null;
}

/**
 * Checks a tree from a view: whitelisted elements and props, children only
 * where allowed, strings cleaned, keys of actionable elements prefixed, the
 * bounds of docs/NATIVE.md §3. Returns the clean node, or null to drop it.
 */
export function sanitizeTree(node, { prefix = 'u.', counter = { nodes: 0 }, depth = 0 } = {}) {
  if (node == null || node === false) return null;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return clean(String(node));
  if (typeof node !== 'object' || Array.isArray(node)) return null;
  if (depth > MAX_DEPTH) throw new Error(`tree deeper than ${MAX_DEPTH}`);
  if (++counter.nodes > MAX_NODES) throw new Error(`tree has more than ${MAX_NODES} nodes`);
  const t = String(node.t || '');
  const allowed = ELEMENT_PROPS[t];
  if (!allowed) return txt({ dimColor: true }, clean(node.p?.alt || node.p?.label || node.p?.text || `[${t || 'element'}]`, 200));
  const src = node.p && typeof node.p === 'object' ? node.p : {};
  const p = {};
  for (const k of allowed) {
    if (!(k in src) || src[k] === undefined || src[k] === null) continue;
    const v = src[k];
    if (k === 'options') {
      const opts = (Array.isArray(v) ? v : []).filter((o) => o && typeof o === 'object' && o.value != null).map((o) => ({ value: clean(o.value, 200), ...(o.label != null ? { label: clean(o.label, 200) } : {}) }));
      const seen = new Set();
      p.options = opts.filter((o) => !seen.has(o.value) && seen.add(o.value)).slice(0, 200);
      continue;
    }
    if (NUMERIC[t]?.has(k)) { if (typeof v === 'number' && Number.isFinite(v)) p[k] = v; continue; }
    if (typeof v === 'string') p[k] = clean(v, k === 'source' && t === 'Svg' ? MAX_SVG + 1 : MAX_TEXT);
    else if (typeof v === 'number' && Number.isFinite(v)) p[k] = v;
    else if (typeof v === 'boolean') p[k] = v;
  }
  if (t === 'Svg') {
    const why = svgProblem(p.source || '');
    if (why) return txt({ dimColor: true }, `${clean(p.alt || '[picture]', 200)} (svg refused: ${why})`);
    if (p.alt == null) p.alt = '';
  }
  if (t === 'Markdown' && p.text == null) p.text = '';
  if (t === 'Code' && p.source == null) p.source = '';
  if (t === 'Link' && !p.href) return txt({ dimColor: true }, clean(p.label || '', 200));
  if (ACTIONABLE.has(t)) {
    if (t === 'Button' && p.label == null) p.label = clean(childText(node), 200);
    if (t === 'Button' && p.key == null) p.key = p.label.slice(0, 64);
    if (p.key == null || p.key === '') return txt({ dimColor: true }, clean(p.label || p.placeholder || `[${t}]`, 200));
    p.key = prefix + clean(p.key, 200);
    if (t === 'Select' && !p.options?.length) return txt({ dimColor: true }, clean(p.label || '[select]', 200));
  }
  const kids = [];
  if (WITH_CHILDREN.has(t)) {
    for (const k of Array.isArray(node.c) ? node.c : []) {
      const c = sanitizeTree(k, { prefix, counter, depth: depth + 1 });
      if (c == null) continue;
      if (t === 'Button' && typeof c !== 'string' && c.t !== 'Text') continue;
      if (t === 'Text' && typeof c !== 'string' && c.t !== 'Text') continue;
      kids.push(c);
    }
  }
  return { t, p, c: kids };
}

function childText(node) {
  const out = [];
  for (const k of Array.isArray(node?.c) ? node.c : []) out.push(typeof k === 'string' ? k : childText(k));
  return out.join('');
}

/** A tree as indented text (the CLI's `lets native`, and tests). */
export function dumpTree(node, indent = 0) {
  if (node == null) return '';
  const pad = '  '.repeat(indent);
  if (typeof node === 'string') return `${pad}${node}\n`;
  const p = node.p || {};
  switch (node.t) {
    case 'Text': return `${pad}${(node.c || []).map((c) => (typeof c === 'string' ? c : childText(c))).join('')}\n`;
    case 'Button': return `${pad}[${p.label ?? childText(node)}]  (${p.key})\n`;
    case 'Input': return `${pad}<${p.label ? p.label + ': ' : ''}${p.value ?? ''}${p.value ? '' : p.placeholder ? '…' + p.placeholder : ''}>  (${p.key})\n`;
    case 'Select': return `${pad}(${p.label ? p.label + ': ' : ''}${p.value ?? p.options?.[0]?.value ?? ''} ▾ ${(p.options || []).map((o) => o.value).join('|')})  (${p.key})\n`;
    case 'Svg': return `${pad}{svg ${p.width ?? '?'}x${p.height ?? '?'} ${p.alt || ''} ${p.source.length} chars}\n`;
    case 'Markdown': return `${pad}${String(p.text).replace(/\n/g, '\n' + pad)}\n`;
    case 'Code': return `${pad}\`\`\`${p.language || ''}\n${pad}${String(p.source).replace(/\n/g, '\n' + pad)}\n${pad}\`\`\`\n`;
    case 'Link': return `${pad}${p.label || p.href} <${p.href}>\n`;
    default: return (node.c || []).map((c) => dumpTree(c, p.borderStyle || p.padding ? indent + 1 : indent)).join('');
  }
}

// ---- one native window -------------------------------------------------------------------------------

class NativeWindow {
  constructor(runtime, { id, u, args, persona, viewport }) {
    this.runtime = runtime;
    this.id = id;
    this.unique = u.name;
    this.manifest = u.manifest;
    this.domains = new Set(u.manifest.domains || []);
    this.title = clean(u.manifest.native?.title || u.manifest.title || u.name, 80);
    this.columns = num(u.manifest.native?.columns, 56);
    this.rows = num(u.manifest.native?.rows, 40);
    this.version = u.manifest.version;
    this.rev = 1;
    this.treeRev = 0;
    this.tree = null;
    this.hasExport = false;
    this.closed = false;
    this.closedAt = 0;
    this.closing = null;
    this.error = null;
    this.opened = Date.now();
    this.actions = [];                       // timestamps, for entity.profile
    this.picks = 0;
    this.current = null;                     // the command being handled (for ctx.reply)
    this.client = { deliver: (msg) => this.deliver(msg) };
    this.shell = {
      name: persona?.name || 'Doto', mood: 'idle', color: persona?.color || '',
      bubble: null, reaction: null, suggestions: [],
      chat: { open: false, lines: [], streams: new Map(), typing: false },
      components: [], toasts: [], listening: false, form: {},
    };
    this.viewport = viewport || { cols: 0, rows: 0 };
    const facts = { unique: this.unique, windowId: id, version: this.version, native: NATIVE_VERSION, args: args || {}, persona: persona || {}, viewport: this.viewport };
    this.context = vm.createContext({}, { name: `lets-native:${this.unique}#${id}`, microtaskMode: 'afterEvaluate' });
    this.context.__json = JSON.stringify(facts);
    S.boot.runInContext(this.context, { timeout: HANDLER_MS });
    const source = fs.readFileSync(u.nativeEntry, 'utf8');
    const script = new vm.Script(source, { filename: u.nativeEntry });
    script.runInContext(this.context, { timeout: HANDLER_MS });
    this.drain();
    if (!this.context.__spec) throw new Error(`${this.unique}: ${path.relative(u.dir, u.nativeEntry)} did not call lets.native({...})`);
    this.run(S.init, null, 'init');
    this.hasExport = !!this.context.__x;
  }

  /** Runs one trampoline with JSON input; drains the queue; returns `__r`. Throws the view's error. */
  run(script, input, what) {
    const c = this.context;
    if (input !== null) { c.__json = JSON.stringify(input); S.parse.runInContext(c, { timeout: HANDLER_MS }); }
    c.__r = undefined;
    try {
      script.runInContext(c, { timeout: HANDLER_MS });
    } catch (err) {
      this.restore();
      this.drain(true);                                     // a failed call announces nothing it did
      const m = err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? `took longer than ${HANDLER_MS} ms` : String(err?.message || err);
      throw new Error(`${this.unique} ${what}: ${m}`);
    } finally { c.__a = undefined; }
    const r = c.__r;
    if (typeof r === 'number' && r > MAX_STATE) { this.restore(); this.drain(true); throw new Error(`${this.unique} ${what}: state over ${MAX_STATE} bytes`); }
    c.__snap = undefined;                                   // the handler stood: drop its snapshot
    this.drain();
    if (typeof r === 'string' && r.length > MAX_STATE) throw new Error(`${this.unique} ${what}: result over ${MAX_STATE} characters`);
    return r;
  }

  /** Puts the state back as it was before the handler that just failed (a no-op when nothing was snapshotted). */
  restore() {
    try { S.restore.runInContext(this.context, { timeout: HANDLER_MS }); } catch { /* ignore */ }
  }

  /** Moves what the view queued (emits, replies, toasts, logs) out of the context. After a failed call the emits are discarded. */
  drain(failed = false) {
    let items = [];
    try { S.drain.runInContext(this.context, { timeout: HANDLER_MS }); items = JSON.parse(this.context.__r || '[]'); } catch { return; }
    if (this.context.__d > 0) this.runtime.log('native', `${this.unique}#${this.id}: dropped ${this.context.__d} queued item(s) over the emit budget`);
    for (const it of Array.isArray(items) ? items : []) {
      const [kind, a, b] = Array.isArray(it) ? it : [];
      if (failed && (kind === 'emit' || kind === 'reply' || kind === 'chat')) continue;
      if (kind === 'emit' || kind === 'reply') {
        // a view may also raise the protocol's own error (lip.error), as the web board does; everything else must be its own domain
        if (!this.domains.has(domainOf(a)) && a !== 'lip.error') { this.runtime.log('native', `${this.unique}#${this.id}: dropped emit of "${a}" (not one of its domains)`); continue; }
        let data = {};
        try { data = JSON.parse(b); } catch { /* keep {} */ }
        const re = (kind === 'reply' || a === 'lip.error') && this.current?.id ? { re: this.current.id } : {};
        this.push(a, a === 'lip.error' ? { code: 'bad_request', ...data } : data, re);
      } else if (kind === 'toast') this.toast(a, b);
      else if (kind === 'chat') { const text = clean(a, 4000).trim(); if (text) { this.shell.chat.lines.push({ role: 'you', text, at: Date.now() }); this.shell.chat.lines = this.shell.chat.lines.slice(-40); this.shell.chat.open = true; this.bump(); } }
      else if (kind === 'after') this.refreshAfter(Number(a));
      else if (kind === 'log') this.runtime.log('native', `${this.unique}#${this.id} ${a}: ${b}`);
    }
  }

  /** `ctx.after(ms)`: one pending redraw per window, so a view can let a highlight or a hint expire. */
  refreshAfter(ms) {
    if (this.closed || !Number.isFinite(ms)) return;
    const at = Date.now() + ms;
    if (this.refresh && this.refresh.at <= at) return;        // an earlier one is already pending
    if (this.refresh) clearTimeout(this.refresh.timer);
    const timer = setTimeout(() => { this.refresh = null; if (!this.closed) this.bump(); }, ms);
    timer.unref?.();
    this.refresh = { at, timer };
  }

  push(type, data, extra = {}) {
    this.runtime.bus.push({ lip: LIP, id: rid('ev'), ts: Date.now(), dir: 'up', from: `unique:${this.unique}#${this.id}`, type, data, ...extra });
  }

  bump() { this.rev++; }

  toast(text, level = 'info') {
    this.shell.toasts.push({ text: clean(text, 300), level: LEVELS.has(level) ? level : 'info', at: Date.now() });
    this.shell.toasts = this.shell.toasts.slice(-TOASTS);
    this.bump();
  }

  /** Toasts fade after TOAST_MS; called before a render so the pane moves on without a command. */
  pruneToasts() {
    const keep = this.shell.toasts.filter((t) => Date.now() - t.at < TOAST_MS);
    if (keep.length === this.shell.toasts.length) return;
    this.shell.toasts = keep;
    this.bump();
  }

  // ---- down: a command from Claude or the host ------------------------------------------------------

  deliver(msg) {
    if (this.closed || !msg || typeof msg.type !== 'string') return;
    const type = msg.type;
    const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
    this.current = msg;
    let error = null;
    try {
      if (this.domains.has(domainOf(type))) {
        const r = this.run(S.on, [type, data], type);
        if (r === -1) throw new Error(`no handler for ${type}`);
      } else this.shellCommand(type, data, msg);
    } catch (err) { error = String(err?.message || err); }
    this.current = null;
    this.bump();
    if (error) this.runtime.log('native', `${this.unique}#${this.id} ${type}: ${error}`);
    if (msg.ack) this.push('lip.ack', error ? { ok: false, error } : { ok: true }, { re: msg.id });
    else if (error) this.push('lip.error', { code: 'bad_request', message: `${type}: ${error}`, re: msg.id });
  }

  shellCommand(type, d, msg) {
    const sh = this.shell;
    switch (type) {
      case 'lip.hello': case 'lip.ping': case 'entity.move': case 'entity.show': case 'entity.hide': case 'ui.theme': return;
      case 'entity.say': { const text = clean(d.text, 280).trim(); if (!text) return; sh.bubble = { text, at: Date.now() }; if (MOODS.has(d.mood)) sh.mood = d.mood; return; }
      case 'entity.mood': if (!MOODS.has(d.mood)) throw new Error(`unknown mood "${d.mood}"`); sh.mood = d.mood; return;
      case 'entity.persona': if (typeof d.name === 'string' && d.name.trim()) sh.name = clean(d.name, 40).trim(); if (typeof d.color === 'string') sh.color = clean(d.color, 32); return;
      case 'entity.react': { const name = String(d.name ?? ''); if (!Object.hasOwn(REACT_GLYPH, name)) throw new Error(`unknown reaction "${name}"`); sh.reaction = { name, at: Date.now() }; return; }
      case 'entity.suggest': {
        const items = (Array.isArray(d.items) ? d.items : []).filter((it) => it && it.id != null && it.label != null).slice(0, 12).map((it) => ({ id: safeId(it.id), label: clean(it.label, 120), hint: it.hint ? clean(it.hint, 160) : '' }));
        sh.suggestions = d.replace ? items : [...sh.suggestions.filter((s) => !items.some((i) => i.id === s.id)), ...items].slice(-12);
        return;
      }
      case 'chat.open': sh.chat.open = true; return;
      case 'chat.close': sh.chat.open = false; return;
      case 'chat.typing': sh.chat.typing = !!d.on; return;
      case 'chat.say': {
        const re = msg.re || d.re || null;
        const done = typeof d.done === 'boolean' ? d.done : typeof msg.done === 'boolean' ? msg.done : !(re || Number.isInteger(d.seq));
        const text = clean(d.text, 8000);
        if (re && sh.chat.streams.has(re)) { const line = sh.chat.streams.get(re); line.text = (line.text + text).slice(0, 8000); if (done) sh.chat.streams.delete(re); }
        else {
          const line = { role: 'entity', text, at: Date.now() };
          sh.chat.lines.push(line);
          if (re && !done) { sh.chat.streams.set(re, line); while (sh.chat.streams.size > CHAT_STREAMS) sh.chat.streams.delete(sh.chat.streams.keys().next().value); }
        }
        sh.chat.lines = sh.chat.lines.slice(-40);
        sh.chat.open = true;
        return;
      }
      case 'component.create': {
        const id = safeId(d.id ?? `c_${Date.now().toString(36)}`);
        const ctype = COMPONENT_TYPES.has(d.type) ? d.type : 'unknown';
        const props = d.props && typeof d.props === 'object' ? d.props : {};
        const rec = { id, type: ctype, rawType: clean(d.type, 40), props };
        const i = sh.components.findIndex((c) => c.id === id);
        if (i >= 0) sh.components[i] = rec; else sh.components.push(rec);
        sh.components = sh.components.slice(-12);
        return;
      }
      case 'component.update': { const c = sh.components.find((x) => x.id === safeId(d.id)); if (!c) throw new Error(`no component "${d.id}"`); c.props = { ...c.props, ...(d.props && typeof d.props === 'object' ? d.props : {}) }; return; }
      case 'component.remove': { const i = sh.components.findIndex((x) => x.id === safeId(d.id)); if (i >= 0) sh.components.splice(i, 1); return; }
      case 'ui.toast': this.toast(d.text, d.level); return;
      case 'session.listening': sh.listening = !!d.on; return;
      case 'session.close': this.farewell(d); return;
      default: return;      // unknown shell or host types are ignored (LIP §8)
    }
  }

  farewell(d = {}) {
    if (this.closing) return;
    const reason = ['handoff', 'idle', 'claude'].includes(d.reason) ? d.reason : 'claude';
    const ms = Math.max(FAREWELL_MIN_MS, clamp(num(d.ms, 1400), 300, 8000));
    this.closing = { reason, text: clean(d.text, 200) || FAREWELL[reason], at: Date.now(), ms };
    this.push('session.closing', { reason });
    this.closing.timer = setTimeout(() => this.runtime.close(this.id, reason), ms);
    this.closing.timer.unref?.();
  }

  stay() {
    if (!this.closing) return;
    clearTimeout(this.closing.timer);
    this.closing = null;
    this.push('session.stay', {});
    this.bump();
  }

  // ---- up: what the human did in the pane ------------------------------------------------------------

  action(act) {
    if (this.closed) return { ok: false, error: 'closed' };
    const key = String(act?.key ?? '');
    const kind = KINDS.has(act?.kind) ? act.kind : 'press';
    const value = act?.value == null ? undefined : clean(act.value, 4000);
    this.actions.push(Date.now());
    if (this.actions.length > 500) this.actions.splice(0, this.actions.length - 500);
    let error = null;
    try {
      if (key.startsWith('s.')) this.shellAction(key.slice(2), kind, value);
      else if (key.startsWith('u.')) { if (this.run(S.action, { key: key.slice(2), kind, ...(value !== undefined ? { value } : {}) }, 'action') === -1) error = 'the view has no action()'; }
      else error = 'unknown key';
    } catch (err) { error = String(err?.message || err); }
    this.bump();
    if (error) { this.runtime.log('native', `${this.unique}#${this.id} action ${key}: ${error}`); this.toast(error, 'error'); }
    return { ok: !error, error: error || undefined };
  }

  shellAction(key, kind, value) {
    const sh = this.shell;
    const [head, id, ...rest] = key.split(':');
    switch (head) {
      case 'chat': if (kind === 'submit' && value?.trim()) { sh.chat.lines.push({ role: 'you', text: value.trim(), at: Date.now() }); sh.chat.lines = sh.chat.lines.slice(-40); this.push('chat.message', { text: value.trim() }); } return;
      case 'chat.toggle': sh.chat.open = !sh.chat.open; return;
      case 'bubble.x': sh.bubble = null; sh.suggestions = []; return;
      case 'send': this.exportNow(); return;
      case 'stay': this.stay(); return;
      case 'pick': { const it = sh.suggestions.find((s) => s.id === id); if (!it) return; this.picks++; sh.suggestions = sh.suggestions.filter((s) => s.id !== id); this.push('entity.pick', { id: it.id, label: it.label }); return; }
      case 'comp': {
        const c = sh.components.find((x) => x.id === id);
        if (!c) return;
        const action = rest[0];
        if (action === 'close') { sh.components = sh.components.filter((x) => x.id !== id); this.push('component.action', { id, action: 'close' }); return; }
        if (action === 'pick') { this.push('component.action', { id, action: 'pick', value: rest.slice(1).join(':') }); return; }
        if (action === 'toggle') { c.props.value = !c.props.value; this.push('component.action', { id, action: 'change', value: c.props.value }); return; }
        if (action === 'slide') { const v = Number(value); if (!Number.isFinite(v)) return; c.props.value = clamp(v, num(c.props.min, 0), num(c.props.max, 100)); this.push('component.action', { id, action: 'change', value: c.props.value }); return; }
        if (action === 'field') { sh.form[id] = { ...(sh.form[id] || {}), [rest.slice(1).join(':')]: value }; return; }
        if (action === 'submit') { const values = {}; for (const f of Array.isArray(c.props.fields) ? c.props.fields : []) if (f?.id != null) values[safeId(f.id, 40)] = sh.form[id]?.[safeId(f.id, 40)] ?? f.value ?? ''; this.push('component.action', { id, action: 'submit', value: values }); return; }
        if (action === 'copy') { this.push('component.action', { id, action: 'copy' }); return; }
        return;
      }
      default: return;
    }
  }

  exportNow() {
    if (!this.hasExport) return;
    const json = this.run(S.export, null, 'export');
    let data = null;
    try { data = JSON.parse(json); } catch { data = null; }
    if (!data || typeof data !== 'object') throw new Error('export() returned no object');
    const t = this.runtime.sessions ? this.runtime.sessions.types(this.unique).export : `${[...this.domains][0]}.export`;
    this.push(t, data);
    this.toast('Sent to Claude — continue in Claude Code', 'ok');
    if (!this.shell.listening) this.toast(`${this.shell.name} is away. Claude reads this with your next message.`, 'info');
  }

  setViewport(vp) {
    const cols = clamp(num(vp?.cols, 0), 0, 1000), rows = clamp(num(vp?.rows, 0), 0, 1000);
    if (!cols && !rows) return;
    if (cols === this.viewport.cols && rows === this.viewport.rows) return;
    this.viewport = { cols, rows };
    try { this.context.__json = JSON.stringify(this.viewport); S.viewport.runInContext(this.context, { timeout: HANDLER_MS }); } catch { /* ignore */ }
    this.bump();
  }

  // ---- the tree --------------------------------------------------------------------------------------

  /** The pane's whole tree: the native shell around the view; cached per rev. */
  render() {
    if (this.tree && this.treeRev === this.rev) return this.tree;
    let body;
    try {
      const raw = JSON.parse(this.run(S.render, null, 'render') ?? 'null');
      body = sanitizeTree(raw);
      const size = JSON.stringify(body).length;
      if (size > MAX_TREE) throw new Error(`tree is ${size} characters; the limit is ${MAX_TREE}`);
      this.error = null;
    } catch (err) {
      this.error = String(err?.message || err);
      this.runtime.log('native', `${this.unique}#${this.id} render: ${this.error}`);
      body = txt({ color: 'error' }, `view error: ${this.error}`);
    }
    this.tree = this.shellTree(body);
    this.treeRev = this.rev;
    return this.tree;
  }

  shellTree(body) {
    const sh = this.shell;
    const head = row({ gap: 1, justifyContent: 'space-between' },
      row({ gap: 1 },
        txt({ bold: true, color: sh.color || 'claude' }, `${MOOD_GLYPH[sh.mood] || '◉'} ${sh.name}`),
        txt({ dimColor: true }, `· ${sh.mood}`),
        txt({ dimColor: true, color: sh.listening ? 'success' : undefined }, sh.listening ? '· listening' : '· away'),
        sh.reaction && Date.now() - sh.reaction.at < 10000 ? txt({}, REACT_GLYPH[sh.reaction.name] || '') : null),
      row({ gap: 1 },
        button('s.chat.toggle', sh.chat.open ? 'chat ×' : 'chat', { dimColor: true, plain: true }),
        this.hasExport ? button('s.send', 'Send to Claude', { variant: 'primary' }) : null));
    const bubble = sh.bubble ? row({ gap: 1 }, txt({ italic: true }, `${sh.name}: ${sh.bubble.text}`), button('s.bubble.x', '×', { plain: true, dimColor: true })) : null;
    const suggestions = sh.suggestions.length ? row({ gap: 1, flexWrap: 'wrap' }, ...sh.suggestions.map((s) => button(`s.pick:${s.id}`, s.label, { dimColor: true }))) : null;
    const parts = [head, bubble, suggestions];
    if (this.closing) {
      parts.push(col({ borderStyle: 'round', borderColor: 'claude', padding: 1, gap: 1, marginTop: 1 },
        txt({ bold: true }, this.closing.text),
        txt({ dimColor: true }, 'This pane is closing…'),
        button('s.stay', 'Keep working', { variant: 'primary' })));
    } else parts.push(col({ marginTop: 1 }, body));
    for (const c of sh.components) parts.push(this.componentTree(c));
    if (sh.chat.open && !this.closing) {
      parts.push(col({ borderStyle: 'single', borderDimColor: true, paddingX: 1, marginTop: 1 },
        ...sh.chat.lines.slice(-CHAT_LINES).map((l) => txt({ wrap: 'wrap' }, txt({ bold: true, dimColor: l.role === 'you' }, l.role === 'you' ? 'you: ' : `${sh.name}: `), mdLite(l.text))),
        sh.chat.typing ? txt({ dimColor: true }, `${sh.name} is typing…`) : null,
        n('Input', { key: 's.chat', placeholder: `Message ${sh.name}…`, submitLabel: 'send' })));
    }
    for (const t of sh.toasts) parts.push(txt({ color: t.level === 'error' ? 'error' : t.level === 'warn' ? 'warning' : t.level === 'ok' ? 'success' : undefined, dimColor: t.level === 'info' }, `› ${t.text}`));
    return col({ flexDirection: 'column' }, ...parts);
  }

  componentTree(c) {
    const p = c.props || {};
    const k = (s) => `s.comp:${c.id}:${s}`;
    const title = row({ justifyContent: 'space-between' }, txt({ bold: true }, clean(p.title || c.rawType || c.type, 80)), button(k('close'), '×', { plain: true, dimColor: true }));
    const inner = [];
    switch (c.type) {
      case 'note': inner.push(n('Markdown', { text: mdLite(p.text ?? '') })); break;
      case 'options': inner.push(row({ gap: 1, flexWrap: 'wrap' }, ...(Array.isArray(p.items) ? p.items : []).slice(0, 12).filter((it) => it && it.id != null).map((it) => button(k(`pick:${safeId(it.id)}`), clean(it.label ?? it.id, 80))))); break;
      case 'toggle': inner.push(row({ gap: 1 }, button(k('toggle'), p.value ? '● on' : '○ off'), txt({ dimColor: true }, clean(p.label || '', 80)))); break;
      case 'slider': inner.push(n('Input', { key: k('slide'), label: clean(p.label || `${num(p.min, 0)}–${num(p.max, 100)}`, 40), value: String(num(p.value, num(p.min, 0))), submitLabel: 'set' })); break;
      case 'progress': { const v = clamp(num(p.value, 0), 0, 1); const w = 20; inner.push(row({ gap: 1 }, txt({ color: 'claude' }, '█'.repeat(Math.round(v * w)) + '░'.repeat(w - Math.round(v * w))), txt({ dimColor: true }, `${Math.round(v * 100)}% ${clean(p.label || '', 60)}`))); break; }
      case 'code': inner.push(n('Code', { source: clean(p.code ?? '', 20000), language: p.lang ? clean(p.lang, 20) : undefined }), button(k('copy'), 'copy', { plain: true, dimColor: true })); break;
      case 'form': {
        for (const f of (Array.isArray(p.fields) ? p.fields : []).slice(0, 12)) {
          if (!f || f.id == null) continue;
          const fid = safeId(f.id, 40), label = clean(f.label || fid, 40), cur = this.shell.form[c.id]?.[fid] ?? (f.value != null ? String(f.value) : '');
          if (f.type === 'select' && Array.isArray(f.options) && f.options.length) inner.push(n('Select', { key: k(`field:${fid}`), label, options: f.options.map((o) => (typeof o === 'object' && o ? { value: clean(o.value ?? o.id, 100), label: clean(o.label ?? o.value ?? o.id, 100) } : { value: clean(o, 100) })), value: cur || undefined }));
          else inner.push(n('Input', { key: k(`field:${fid}`), label, value: cur, submitLabel: 'set' }));
        }
        inner.push(button(k('submit'), clean(p.submit || 'Submit', 40), { variant: 'primary' }));
        break;
      }
      case 'image-drop': inner.push(txt({ dimColor: true }, 'Images cannot be dropped into the native pane. Paste one in the web window, or send a path in chat.')); break;
      default: inner.push(n('Code', { source: JSON.stringify(p, null, 1).slice(0, 4000), language: 'json' }));
    }
    return col({ borderStyle: 'round', borderDimColor: true, paddingX: 1, marginTop: 1 }, title, ...inner);
  }

  /** The interaction profile the web shell measures with the pointer, as far as a pane can: counts and rhythm. */
  profile() {
    const ts = this.actions;
    const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    const sessionMs = Date.now() - this.opened;
    return { pace: 0, clickRate: sessionMs > 0 ? Math.round((ts.length / sessionMs) * 60000 * 10) / 10 : 0, dwell: gaps.length ? gaps[gaps.length >> 1] : 0, regions: { tl: 0, tr: 0, bl: 0, br: 0, c: 0 }, idleMs: ts.length ? Date.now() - ts[ts.length - 1] : sessionMs, sessionMs, summons: 0, picks: this.picks, dismisses: 0, secrets: 0, native: true, actions: ts.length };
  }

  destroy(reason) {
    if (this.closed) return;
    this.closed = true;
    this.closedAt = Date.now();
    if (this.closing?.timer) clearTimeout(this.closing.timer);
    if (this.refresh?.timer) clearTimeout(this.refresh.timer);
    try { this.run(S.destroy, null, 'destroy'); } catch (err) { this.runtime.log('native', String(err?.message || err)); }
    this.push('entity.profile', this.profile());
    this.bump();
    this.reason = reason;
    this.context = null;
  }
}

// ---- the runtime: every native window of this host ------------------------------------------------------

export class NativeRuntime {
  constructor({ bus, registry, entity = null, sessions = null, log = () => {} }) {
    this.bus = bus;
    this.registry = registry;
    this.entity = entity;
    this.sessions = sessions;
    this.log = log;
    this.windows = new Map();
    this.seenAt = 0;            // when a lets-native mod last synced
    this.seenVersion = null;
  }

  /** The mod's presence, for the `open` tool's advice. */
  get modSeen() { return this.seenAt > 0 && Date.now() - this.seenAt < 15_000; }

  /**
   * Creates a native window of `unique`: loads the view, attaches it to the
   * bus (queued commands are delivered now), announces it. Throws when the
   * unique has no native entry or the view fails to load (nothing is left behind).
   */
  open(unique, { windowId = null, args = {}, viewport = null } = {}) {
    const u = this.registry.get(unique);
    if (!u || !u.ok) throw new Error(`unknown or invalid unique "${unique}"`);
    if (!u.nativeEntry) throw new Error(`unique "${unique}" has no native view (manifest "native.entry")`);
    const id = windowId || rid('w').slice(2, 14);
    const old = this.windows.get(id);
    if (old && !old.closed) throw new Error(`native window ${id} is already open`);
    if (old) { this.windows.delete(id); this.bus.drop?.(id); }          // a closed window reopened under its id starts clean
    const persona = this.entity ? this.entity.personaForShell() : {};
    const w = new NativeWindow(this, { id, u, args: args && typeof args === 'object' ? args : {}, persona, viewport });
    this.windows.set(id, w);
    this.bus.window(id, unique, 'native');
    this.bus.attach(id, unique, w.client);            // flushes anything queued (a restore on resume)
    w.push('session.opened', { windowId: id, unique, mode: 'native' });
    w.push('lip.ready', { unique, version: u.manifest.version, caps: ['entity', 'chat', 'components'], viewport: { ...w.viewport, native: true }, ua: 'lets-native' });
    w.shell.listening = !!this.bus.listening;
    this.log('native', `opened ${unique}#${id}`);
    return { windowId: id, unique, title: w.title, columns: w.columns, rows: w.rows };
  }

  get(id) { return this.windows.get(id) || null; }

  list() {
    return [...this.windows.values()].map((w) => ({ id: w.id, unique: w.unique, title: w.title, columns: w.columns, rows: w.rows, rev: w.rev, closed: w.closed, closing: !!w.closing, opened: w.opened }));
  }

  /**
   * What the mod polls: every window, with the tree where `rev` moved past what
   * it knows. `viewports` sizes each pane by window id (`cols`/`rows` are the
   * fallback for every window). A closed window is listed until the poller has
   * seen it or FORGET_MS passed, then dropped.
   */
  sync({ known = {}, cols = 0, rows = 0, viewports = {}, modVersion = null } = {}) {
    this.seenAt = Date.now();
    if (modVersion) this.seenVersion = String(modVersion).slice(0, 32);
    const out = [];
    for (const w of this.windows.values()) {
      const k = Number(known[w.id]);
      if (w.closed) {
        out.push({ id: w.id, unique: w.unique, title: w.title, rev: w.rev, closed: true });
        if (Number.isFinite(k) || Date.now() - w.closedAt > FORGET_MS) this.windows.delete(w.id);
        continue;
      }
      w.setViewport(viewports[w.id] || { cols, rows });
      w.pruneToasts();
      const entry = { id: w.id, unique: w.unique, title: w.title, columns: w.columns, rows: w.rows, rev: w.rev, closed: false };
      if (!Number.isFinite(k) || k < w.rev) entry.tree = w.render();
      out.push(entry);
    }
    return { windows: out, listening: !!this.bus.listening, ts: Date.now() };
  }

  action(id, act) {
    const w = this.windows.get(id);
    if (!w) return { ok: false, error: 'no such native window' };
    const r = w.action(act);
    return { ...r, rev: w.rev, tree: w.closed ? undefined : w.render(), closed: w.closed || undefined };
  }

  /** The window goes away: the person closed the pane, the farewell ended, or Claude asked. */
  close(id, reason = 'closed') {
    const w = this.windows.get(id);
    if (!w) return { ok: false, error: 'no such native window' };
    if (w.closed) return { ok: true, closed: true };
    w.destroy(reason);
    this.bus.detach(id, w.client);
    this.bus.forget(id);
    this.log('native', `closed ${w.unique}#${id} (${reason})`);
    return { ok: true, closed: true };
  }

  /** Drops windows of a host that is shutting down. */
  stop() { for (const id of [...this.windows.keys()]) { try { this.close(id, 'host'); } catch { /* ignore */ } } }
}
