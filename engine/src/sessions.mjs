/**
 * Sessions: what a window handed to Claude, kept so it can come back.
 *
 * When a unique's *export* event arrives ("Send to Claude" on the graph board)
 * the engine saves its payload under ~/.lets/sessions/<unique>/<id>.json, tells
 * the window to close itself (`session.close`) and marks the event
 * (`data.session = {id, handoff: true}`) so Claude answers in the transcript.
 * A later `open {resume}` queues the unique's *restore* command with the saved
 * payload, and the board comes back exactly as it was sent.
 *
 * Which event/command types play these roles comes from the unique's manifest
 * (`"session": {export, snapshot, restore}`), with `<domain>.export` /
 * `<domain>.snapshot` / `<domain>.load` as the fallback convention. The engine
 * never looks inside the payload beyond a shallow scan for a few labels to
 * build a one-line summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, readJson, writeJson } from './paths.mjs';
import { rid } from './ids.mjs';

const MAX_PAYLOAD = 2 * 1024 * 1024;   // a session file never exceeds this (export payloads are small by design)
const KEEP_PER_UNIQUE = 40;            // oldest sessions beyond this are pruned
const LABEL_KEYS = new Set(['label', 'title', 'name', 'text', 'question']);

export class Sessions {
  constructor({ registry, log = () => {}, project = process.cwd() } = {}) {
    this.registry = registry;
    this.log = log;
    this.project = project;
    this.dir = DIRS.sessions;
    fs.mkdirSync(this.dir, { recursive: true });
    this.byWindow = new Map();          // windowId -> session id (this host's lifetime)
  }

  /** `~/.lets/config.json` → `handoff`: "close" (default) or "stay". */
  get handoff() {
    const cfg = readJson(path.join(DIRS.home, 'config.json'), {});
    return cfg?.handoff === 'stay' ? 'stay' : 'close';
  }

  /** The event/command types that play the export / snapshot / restore roles for a unique. */
  types(unique) {
    const u = this.registry?.get(unique);
    const m = u?.manifest || {};
    const dom = (m.domains || [unique])[0];
    const s = m.session && typeof m.session === 'object' ? m.session : {};
    return {
      export: typeof s.export === 'string' ? s.export : `${dom}.export`,
      snapshot: typeof s.snapshot === 'string' ? s.snapshot : `${dom}.snapshot`,
      restore: typeof s.restore === 'string' ? s.restore : `${dom}.load`,
    };
  }

  /** Classify an up-event: 'export' | 'snapshot' | null. */
  roleOf(msg) {
    const unique = uniqueOf(msg?.from);
    if (!unique) return null;
    const t = this.types(unique);
    if (msg.type === t.export) return 'export';
    if (msg.type === t.snapshot) return 'snapshot';
    return null;
  }

  /**
   * Save (or update) the session of a window from an export/snapshot event.
   * Returns the record (without the payload) or null when the payload is unusable.
   */
  save(msg, { role = 'export' } = {}) {
    const unique = uniqueOf(msg.from);
    const windowId = windowOf(msg.from);
    if (!unique || !windowId) return null;
    const data = msg.data && typeof msg.data === 'object' ? { ...msg.data } : null;
    if (!data) return null;
    delete data.session;
    let bytes;
    try { bytes = Buffer.byteLength(JSON.stringify(data)); } catch { return null; }
    if (bytes > MAX_PAYLOAD) { this.log('sessions', `payload too large (${bytes} B) from ${msg.from}; not saved`); return null; }
    const id = this.byWindow.get(windowId) || this.findByWindow(unique, windowId)?.id || rid('s').slice(0, 14);
    this.byWindow.set(windowId, id);
    const prev = this.read(unique, id);
    const rec = {
      id, unique, windowId,
      created: prev?.created || Date.now(),
      at: Date.now(),
      role,                                   // what produced the latest payload
      label: prev?.label || null,
      summary: summarize(data),
      project: prev?.project || this.project,
      bytes,
      data,
    };
    writeJson(this.file(unique, id), rec);
    this.prune(unique);
    return strip(rec);
  }

  file(unique, id) { return path.join(this.dir, safe(unique), `${safe(id)}.json`); }

  read(unique, id) { return readJson(this.file(unique, id)); }

  /** Most recent first. `unique` optional. Without `full`, payloads are stripped. */
  list({ unique = null, limit = 20, full = false } = {}) {
    const out = [];
    let dirs = [];
    try { dirs = unique ? [safe(unique)] : fs.readdirSync(this.dir); } catch { return out; }
    for (const d of dirs) {
      const dir = path.join(this.dir, d);
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
      for (const f of files) {
        const rec = readJson(path.join(dir, f));
        if (rec?.id) out.push(full ? rec : strip(rec));
      }
    }
    out.sort((a, b) => (b.at || 0) - (a.at || 0));
    return out.slice(0, Math.max(1, limit));
  }

  /** `id` may be a session id or "last" (the newest for that unique, preferring this project). */
  get(unique, id) {
    if (!id || id === 'last' || id === 'latest') {
      const all = this.list({ unique, limit: 50, full: true });
      return all.find((s) => s.project === this.project) || all[0] || null;
    }
    const rec = this.read(unique, id);
    if (rec) return rec;
    // allow a prefix of the id
    return this.list({ unique, limit: 50, full: true }).find((s) => s.id.startsWith(id)) || null;
  }

  findByWindow(unique, windowId) {
    return this.list({ unique, limit: 100 }).find((s) => s.windowId === windowId) || null;
  }

  label(unique, id, label) {
    const rec = this.get(unique, id);
    if (!rec) return null;
    rec.label = label == null ? null : String(label).slice(0, 80);
    writeJson(this.file(unique, rec.id), rec);
    return strip(rec);
  }

  remove(unique, id) {
    const rec = this.get(unique, id);
    if (!rec) return false;
    try { fs.unlinkSync(this.file(unique, rec.id)); } catch { return false; }
    for (const [w, sid] of this.byWindow) if (sid === rec.id) this.byWindow.delete(w);
    return true;
  }

  /** The restore command for a saved session: `{type, data}` or null. */
  restoreCommand(rec) {
    if (!rec?.unique || !rec.data) return null;
    const t = this.types(rec.unique);
    return { type: t.restore, data: rec.data };
  }

  prune(unique) {
    const all = this.list({ unique, limit: 1000 });
    for (const s of all.slice(KEEP_PER_UNIQUE)) { try { fs.unlinkSync(this.file(unique, s.id)); } catch { /* ignore */ } }
  }
}

/** A session record without its payload (what tools and briefs return). */
export function strip(rec) {
  if (!rec) return null;
  const { data, ...rest } = rec;
  return rest;
}

/**
 * One line about a payload without knowing its schema: up to 8 short strings
 * found under label/title/name/text/question keys (depth ≤ 4), plus counts of
 * the arrays seen. Good enough to tell "auth flow (12 nodes)" from "bounty harness (19 nodes)".
 */
export function summarize(data) {
  const labels = [];
  const counts = {};
  const seen = new Set();
  const walk = (v, depth, key) => {
    if (labels.length >= 8 || depth > 4 || v == null) return;
    if (typeof v === 'string') {
      if (LABEL_KEYS.has(key)) { const s = v.trim().replace(/\s+/g, ' ').slice(0, 40); if (s && !seen.has(s)) { seen.add(s); labels.push(s); } }
      return;
    }
    if (Array.isArray(v)) { if (key) counts[key] = (counts[key] || 0) + v.length; for (const x of v.slice(0, 200)) walk(x, depth + 1, key); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, depth + 1, k);
  };
  walk(data, 0, '');
  const parts = [];
  if (labels.length) parts.push(labels.join(' · '));
  const c = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  if (c.length) parts.push(`(${c.join(', ')})`);
  return parts.join(' ').slice(0, 240) || '(empty)';
}

function uniqueOf(from) { const m = /^unique:([a-z][a-z0-9-]*)#/.exec(String(from || '')); return m ? m[1] : null; }
function windowOf(from) { const i = String(from || '').indexOf('#'); return i > 0 ? String(from).slice(i + 1) : null; }
function safe(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'x'; }
