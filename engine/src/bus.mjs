/**
 * The LIP bus: one ring buffer of up-events with named cursors and long-poll
 * waiters, plus per-window down-queues feeding SSE streams.
 */
import { rid } from './ids.mjs';

const LIP = 1;
const COALESCE_TYPES = new Set(['graph.changed', 'entity.profile', 'session.focus', 'session.blur']);
const COALESCE_MS = 400;

export class Bus {
  constructor({ capacity = 2000, log = () => {} } = {}) {
    this.capacity = capacity;
    this.log = log;
    this.seq = 0;                  // monotonic sequence of accepted up-events
    this.ring = [];                // [{seq, msg}]
    this.cursors = new Map();      // name -> last seq delivered
    this.waiters = new Set();      // {resolve, timer}
    this.windows = new Map();      // windowId -> {id, unique, clients:Set<res>, pending:[], lastSeen, ready, viewport}
    this.pendingAcks = new Map();  // commandId -> {resolve, timer}
    this.stats = { up: 0, down: 0, dropped: 0, coalesced: 0 };
  }

  // ---- windows ------------------------------------------------------------

  window(id, unique) {
    let w = this.windows.get(id);
    if (!w) {
      w = { id, unique, clients: new Set(), pending: [], lastSeen: Date.now(), ready: null, opened: Date.now() };
      this.windows.set(id, w);
    }
    if (unique && !w.unique) w.unique = unique;
    return w;
  }

  attach(id, unique, res) {
    const w = this.window(id, unique);
    w.clients.add(res);
    w.lastSeen = Date.now();
    // flush anything queued while nobody was listening
    for (const m of w.pending.splice(0)) this._write(res, m);
    return w;
  }

  detach(id, res) {
    const w = this.windows.get(id);
    if (!w) return;
    w.clients.delete(res);
    if (w.clients.size === 0) {
      w.lastSeen = Date.now();
      // keep the window record for a grace period so a reload re-attaches
      setTimeout(() => {
        const cur = this.windows.get(id);
        if (cur && cur.clients.size === 0 && Date.now() - cur.lastSeen > 25_000) {
          this.windows.delete(id);
          this.push({ lip: LIP, id: rid('ev'), ts: Date.now(), dir: 'up', from: 'host', type: 'session.closed', data: { windowId: id, unique: cur.unique } });
        }
      }, 30_000).unref?.();
    }
  }

  windowList() {
    return [...this.windows.values()].map((w) => ({
      id: w.id, unique: w.unique, connected: w.clients.size > 0, ready: !!w.ready,
      viewport: w.ready?.viewport, opened: w.opened, lastSeen: w.lastSeen, listening: this.listening,
    }));
  }

  // ---- up (events) ----------------------------------------------------------

  push(msg) {
    if (!msg || msg.lip !== LIP || msg.dir !== 'up' || typeof msg.type !== 'string') {
      this.stats.dropped++;
      return false;
    }
    if (msg.type === 'lip.ack' && msg.re && this.pendingAcks.has(msg.re)) {
      const p = this.pendingAcks.get(msg.re);
      clearTimeout(p.timer);
      this.pendingAcks.delete(msg.re);
      p.resolve(msg.data || { ok: true });
      return true;
    }
    if (msg.type === 'lip.pong') return true;
    if (msg.type === 'lip.ready') {
      const wid = msg.from?.split('#')[1];
      if (wid) this.window(wid, msg.data?.unique).ready = msg.data;
    }
    // coalesce chatty types: replace the previous undelivered one of the same type+from
    if (COALESCE_TYPES.has(msg.type)) {
      // only entries no reader has seen yet may be replaced in place
      const delivered = Math.max(0, ...this.cursors.values());
      for (let i = this.ring.length - 1; i >= 0; i--) {
        const e = this.ring[i];
        if (e.seq <= delivered) break;
        if (e.msg.type === msg.type && e.msg.from === msg.from && msg.ts - e.msg.ts < COALESCE_MS) {
          e.msg = msg;
          this.stats.coalesced++;
          return true;
        }
      }
    }
    this.seq++;
    this.ring.push({ seq: this.seq, msg });
    if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity);
    this.stats.up++;
    for (const w of this.waiters) w.resolve();
    return true;
  }

  /** Events after the named cursor; advances it. */
  read(cursor = 'claude', { max = 50, types = null, since = null } = {}) {
    const from = since !== null ? since : (this.cursors.get(cursor) ?? 0);
    const out = [];
    let last = from;
    for (const e of this.ring) {
      if (e.seq <= from) continue;
      last = e.seq;
      if (types && !types.some((t) => matchType(t, e.msg.type))) continue;
      out.push(e.msg);
      if (out.length >= max) break;
    }
    this.cursors.set(cursor, last);
    const pending = this.ring.filter((e) => e.seq > last).length;
    return { events: out, cursor: last, pending };
  }

  peekCount(cursor = 'claude') {
    const from = this.cursors.get(cursor) ?? 0;
    return this.ring.filter((e) => e.seq > from).length;
  }

  /** Resolves when at least one event is newer than the cursor, or after waitMs. */
  wait(cursor = 'claude', waitMs = 0) {
    if (this.peekCount(cursor) > 0 || waitMs <= 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const w = { cursor, resolve: () => { clearTimeout(w.timer); this.waiters.delete(w); this._listening(); resolve(true); } };
      w.timer = setTimeout(() => { this.waiters.delete(w); this._listening(); resolve(false); }, waitMs);
      this.waiters.add(w);
      this._listening();
    });
  }

  /**
   * Whether Claude is blocked in `listen` right now (a waiter on the `claude`
   * cursor). Windows are told on every flip (`session.listening {on}`) so the
   * shell can show "Pip is listening" vs "away", and `touchListening()` keeps
   * `on` true for a grace period after each listen call so a tight loop of
   * short polls still reads as attentive.
   */
  get listening() {
    return [...this.waiters].some((w) => w.cursor === 'claude') || Date.now() < (this.listenGraceUntil || 0);
  }

  touchListening(graceMs = 8000) {
    this.listenGraceUntil = Date.now() + graceMs;
    this._listening();
    clearTimeout(this._graceTimer);
    this._graceTimer = setTimeout(() => this._listening(), graceMs + 50);
    this._graceTimer.unref?.();
  }

  _listening() {
    const on = this.listening;
    if (on === this._lastListening) return;
    this._lastListening = on;
    this.send({ type: 'session.listening', data: { on, at: Date.now() }, from: 'host', transient: true });
  }

  // ---- down (commands) --------------------------------------------------------

  /**
   * Enqueue a command. `to` may be a windowId, `unique:<name>`, or undefined
   * (= every connected window). Returns the delivered window ids.
   */
  send(cmd, to) {
    const msg = { lip: LIP, id: cmd.id || rid('cm'), ts: Date.now(), dir: 'down', from: cmd.from || 'claude', ...cmd };
    delete msg.to;
    const transient = !!msg.transient;      // state pings (session.listening): never queued for absent windows
    delete msg.transient;
    const targets = this._targets(to ?? cmd.to);
    for (const w of targets) {
      if (w.clients.size === 0) {
        if (!transient && (!msg.ttl || Date.now() - msg.ts < msg.ttl)) w.pending.push(msg);
        continue;
      }
      for (const res of w.clients) this._write(res, msg);
    }
    this.stats.down++;
    return { id: msg.id, delivered: targets.filter((w) => w.clients.size > 0).map((w) => w.id), queued: targets.filter((w) => w.clients.size === 0).map((w) => w.id) };
  }

  /** send() and wait for the window's lip.ack (commands flagged ack:true). */
  sendAck(cmd, to, timeoutMs = 5000) {
    const r = this.send({ ...cmd, ack: true }, to);
    if (!r.delivered.length) return Promise.resolve({ ...r, ack: null });
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pendingAcks.delete(r.id); resolve({ ...r, ack: { ok: false, error: 'timeout' } }); }, timeoutMs);
      this.pendingAcks.set(r.id, { resolve: (ack) => resolve({ ...r, ack }), timer });
    });
  }

  _targets(to) {
    const all = [...this.windows.values()];
    if (!to) return all;
    if (to.startsWith('unique:')) return all.filter((w) => w.unique === to.slice(7));
    const w = this.windows.get(to);
    return w ? [w] : [];
  }

  _write(res, msg) {
    try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch { /* closed */ }
  }

  heartbeat() {
    for (const w of this.windows.values()) for (const res of w.clients) {
      try { res.write(': hb\n\n'); } catch { /* closed */ }
    }
  }
}

export function matchType(pattern, type) {
  if (pattern === '*' || pattern === type) return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return false;
}
