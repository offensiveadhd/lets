/**
 * The companion entity: a persisted persona, a memory of observations, a
 * learned interaction profile, and "special skills" Claude teaches itself.
 * Everything lives under ~/.lets/entity so it survives sessions and plugin updates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, readJson, writeJson, appendJsonl } from './paths.mjs';

const DEFAULT_PERSONA = {
  name: 'Doto',
  born: null,
  tagline: 'a dot that does',
  traits: { speed: 0.6, distance: 0.45, chatty: 0.4, playful: 0.7, formality: 0.15, curiosity: 0.6 },
  color: '#a66bff',
  mood: 'idle',
  version: 1,
  sessions: 0,
  likes: [],      // learned user likes ("short labels", "tree layouts")
  dislikes: [],
  nicknames: {},  // what the user calls things
};

/** Names and taglines of earlier default personas (the human never chose them). */
const OLD_DEFAULTS = [{ name: 'Pip', tagline: 'small, bright, eager to help' }];

/**
 * A persona still carrying an earlier default name (and its default tagline, so the human never
 * customised it) moves to the current default. Learned traits, likes and memory are kept.
 * @returns {{from:string,to:string}|null}
 */
export function migratePersona(persona) {
  const old = OLD_DEFAULTS.find((o) => o.name === persona.name && (persona.tagline === o.tagline || !persona.tagline));
  if (!old) return null;
  persona.name = DEFAULT_PERSONA.name;
  persona.tagline = DEFAULT_PERSONA.tagline;
  return { from: old.name, to: DEFAULT_PERSONA.name };
}

const DEFAULT_PROFILE = {
  pace: null, clickRate: null, dwell: null, regions: null, idleMs: null,
  sessionsSeen: 0, summons: 0, picks: 0, dismisses: 0, lastSeen: null,
  secrets: [],    // names of the secret moves the human found, in order of discovery
};

/** The companion's secret moves (docs/ENTITY.md); the shell emits `entity.secret {name}` on a first find. */
export const SECRET_MOVES = ['spin', 'dance', 'disco', 'dizzy', 'nightcap', 'boop', 'wheee'];

export class Entity {
  constructor() {
    this.personaFile = path.join(DIRS.entity, 'persona.json');
    this.profileFile = path.join(DIRS.entity, 'profile.json');
    this.memoryFile = path.join(DIRS.entity, 'memory.jsonl');
    this.skillsDir = DIRS.entitySkills;
    fs.mkdirSync(this.skillsDir, { recursive: true });
    // own copies of the nested defaults: a fresh install must never mutate DEFAULT_PERSONA through learn()
    const saved = readJson(this.personaFile) || {};
    this.persona = { ...DEFAULT_PERSONA, ...saved, traits: { ...DEFAULT_PERSONA.traits, ...(saved.traits || {}) }, likes: [...(saved.likes || [])], dislikes: [...(saved.dislikes || [])], nicknames: { ...(saved.nicknames || {}) } };
    this.migrated = migratePersona(this.persona);
    if (this.migrated) appendJsonl(this.memoryFile, { ts: this.stamp(), kind: 'note', text: `the companion's default name changed from ${this.migrated.from} to ${this.migrated.to}; the human can rename it with "entity rename"`, weight: 1 });
    if (!this.persona.born) this.persona.born = new Date().toISOString();
    this.profile = { ...DEFAULT_PROFILE, ...(readJson(this.profileFile) || {}) };
    this.profile.secrets = Array.isArray(this.profile.secrets) ? [...this.profile.secrets] : [];
    // finds recorded before 0.6.0 live only in memory.jsonl (`… secret move "spin"`): merge those names in
    for (const m of this.memory(500)) {
      const n = m.kind === 'secret' ? m.text.match(/"([a-z-]+)"/)?.[1] : null;
      if (n && SECRET_MOVES.includes(n) && !this.profile.secrets.includes(n)) this.profile.secrets.push(n);
    }
    this.persona.sessions = (this.persona.sessions || 0) + 1;
    this.profile.sessionsSeen = (this.profile.sessionsSeen || 0) + 1;
    this.save();
  }

  save() {
    writeJson(this.personaFile, this.persona);
    writeJson(this.profileFile, this.profile);
  }

  /** A memory line's `ts`: wall-clock ms, strictly increasing within this process so two lines never share an id. */
  stamp() {
    const t = Date.now();
    this._ts = t > (this._ts || 0) ? t : this._ts + 1;
    return this._ts;
  }

  /** What the shell needs to configure the sprite. */
  personaForShell() {
    const { name, traits, color, mood, tagline } = this.persona;
    return { name, traits, color, mood, tagline, profile: { pace: this.profile.pace, clickRate: this.profile.clickRate } };
  }

  /** Compact brief for Claude at the start of a lets session (keep it short — it costs tokens every time). */
  brief() {
    const skills = this.listSkills();
    const recent = this.recentMemory(8);
    return {
      persona: { name: this.persona.name, tagline: this.persona.tagline, traits: this.persona.traits, mood: this.persona.mood, sessions: this.persona.sessions, likes: this.persona.likes.slice(-8), dislikes: this.persona.dislikes.slice(-5), nicknames: this.persona.nicknames },
      profile: { pace: this.profile.pace, clickRate: this.profile.clickRate, dwell: this.profile.dwell, regions: this.profile.regions, summons: this.profile.summons, picks: this.profile.picks, secrets: this.profile.secrets },
      skills: skills.map((s) => ({ name: s.name, triggers: s.triggers, confidence: s.confidence })),
      recentMemory: recent,
    };
  }

  // ---- learning -------------------------------------------------------------

  /** Record an observation (from Claude or from an entity.profile event). */
  learn({ kind = 'note', text, weight = 1, traits = null, likes = [], dislikes = [], nicknames = {}, mood = null } = {}) {
    if (text) appendJsonl(this.memoryFile, { ts: this.stamp(), kind, text: String(text).slice(0, 400), weight });
    if (traits) for (const [k, v] of Object.entries(traits)) {
      if (k in this.persona.traits && typeof v === 'number') this.persona.traits[k] = clamp01(this.persona.traits[k] * 0.7 + v * 0.3);
    }
    for (const l of likes) if (l && !this.persona.likes.includes(l)) this.persona.likes.push(String(l).slice(0, 60));
    for (const d of dislikes) if (d && !this.persona.dislikes.includes(d)) this.persona.dislikes.push(String(d).slice(0, 60));
    Object.assign(this.persona.nicknames, nicknames);
    if (mood) this.persona.mood = mood;
    this.persona.likes = this.persona.likes.slice(-40);
    this.persona.dislikes = this.persona.dislikes.slice(-20);
    this.save();
    return this.brief().persona;
  }

  /** Fold an `entity.profile` event (aggregate stats from the shell) into the learned profile. */
  absorbProfile(p = {}) {
    const ema = (old, nu, a = 0.3) => (typeof nu !== 'number' ? old : old == null ? nu : old * (1 - a) + nu * a);
    this.profile.pace = ema(this.profile.pace, p.pace);
    this.profile.clickRate = ema(this.profile.clickRate, p.clickRate);
    this.profile.dwell = ema(this.profile.dwell, p.dwell);
    this.profile.idleMs = ema(this.profile.idleMs, p.idleMs);
    if (p.regions) this.profile.regions = p.regions;
    this.profile.summons += p.summons || 0;
    this.profile.picks += p.picks || 0;
    this.profile.dismisses += p.dismisses || 0;
    this.profile.lastSeen = Date.now();
    // the persona adapts: fast users get a quicker, less chatty companion
    if (typeof p.pace === 'number') {
      const fast = clamp01((p.pace - 300) / 1200);
      this.persona.traits.speed = clamp01(this.persona.traits.speed * 0.8 + (0.35 + fast * 0.5) * 0.2);
      this.persona.traits.chatty = clamp01(this.persona.traits.chatty * 0.9 + (0.7 - fast * 0.4) * 0.1);
    }
    if ((p.dismisses || 0) > (p.picks || 0) + 2) this.persona.traits.chatty = clamp01(this.persona.traits.chatty - 0.05);
    this.save();
    return this.profile;
  }

  recentMemory(n = 10) {
    try {
      const lines = fs.readFileSync(this.memoryFile, 'utf8').trim().split('\n').filter(Boolean);
      return lines.slice(-n).map((l) => { try { const o = JSON.parse(l); return `${o.kind}: ${o.text}`; } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }

  setMood(mood) { this.persona.mood = mood; this.save(); return mood; }

  rename(name) { this.set({ name: String(name ?? '') }); return this.persona.name; }

  // ---- den: everything he knows, and the human's edits ------------------------

  /**
   * Everything the companion knows, for the den unique (`GET /lip/entity`,
   * `entity full`): persona with likes/dislikes/nicknames, the learned profile
   * with the secrets found, every special skill with its body, the last 60
   * memory lines (each with its `ts`, which is the line's id), the list of all
   * secret moves and the default persona.
   */
  full() {
    const p = this.persona;
    return {
      persona: { name: p.name, tagline: p.tagline, born: p.born, color: p.color, mood: p.mood, sessions: p.sessions, traits: { ...p.traits }, likes: [...p.likes], dislikes: [...p.dislikes], nicknames: { ...p.nicknames } },
      profile: { ...this.profile, secrets: [...this.profile.secrets] },
      skills: this.listSkills().map(({ file, ...s }) => s),
      memory: this.memory(60),
      secretsAll: [...SECRET_MOVES],
      defaults: { name: DEFAULT_PERSONA.name, tagline: DEFAULT_PERSONA.tagline, color: DEFAULT_PERSONA.color, traits: { ...DEFAULT_PERSONA.traits } },
      at: Date.now(),
    };
  }

  /** The last `n` memory lines, oldest first, each `{ts, kind, text, weight}`; `ts` identifies a line. */
  memory(n = 30) {
    const take = Math.max(1, Math.floor(Number(n)) || 30);
    try {
      const lines = fs.readFileSync(this.memoryFile, 'utf8').trim().split('\n').filter(Boolean);
      return lines.slice(-take).map((l) => {
        try { const o = JSON.parse(l); return o && typeof o === 'object' ? { ts: Number(o.ts) || 0, kind: String(o.kind || 'note'), text: String(o.text || ''), weight: Number.isFinite(o.weight) ? o.weight : 1 } : null; } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  /**
   * Direct assignment of persona fields (the human edited them in den), unlike
   * `learn`, which blends traits in. Unknown traits and bad colours are ignored.
   */
  set({ name, tagline, traits, color } = {}) {
    if (typeof name === 'string' && name.trim()) this.persona.name = name.trim().slice(0, 24);
    if (typeof tagline === 'string') this.persona.tagline = tagline.trim().slice(0, 120);
    if (traits && typeof traits === 'object' && !Array.isArray(traits)) for (const [k, v] of Object.entries(traits)) if (Object.hasOwn(this.persona.traits, k) && typeof v === 'number' && Number.isFinite(v)) this.persona.traits[k] = clamp01(v);
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) this.persona.color = color;
    this.save();
    return this.brief().persona;
  }

  /** Remove exactly these likes, dislikes, nickname keys and memory lines (by `ts`). Returns how many went. */
  unlearn({ likes = [], dislikes = [], nicknames = [], memory = [] } = {}) {
    const removed = { likes: 0, dislikes: 0, nicknames: 0, memory: 0 };
    const drop = (arr, items) => { const set = new Set([].concat(items).map(String)); const out = arr.filter((x) => !set.has(x)); return [out, arr.length - out.length]; };
    [this.persona.likes, removed.likes] = drop(this.persona.likes, likes);
    [this.persona.dislikes, removed.dislikes] = drop(this.persona.dislikes, dislikes);
    for (const k of [].concat(nicknames)) if (k in this.persona.nicknames) { delete this.persona.nicknames[k]; removed.nicknames++; }
    const ts = new Set([].concat(memory).map(Number).filter(Boolean));
    if (ts.size) {
      try {
        const lines = fs.readFileSync(this.memoryFile, 'utf8').split('\n').filter(Boolean);
        const kept = lines.filter((l) => { try { return !ts.has(Number(JSON.parse(l).ts)); } catch { return true; } });
        const gone = lines.length - kept.length;
        if (gone) {
          const tmp = `${this.memoryFile}.${process.pid}.tmp`;
          try { fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : ''); fs.renameSync(tmp, this.memoryFile); removed.memory = gone; }
          catch (err) { try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ } throw err; }
        }
      } catch (err) { if (err?.code !== 'ENOENT') removed.error = `memory lines not removed: ${err?.message || err}`; }
    }
    this.save();
    return { removed };
  }

  /** Persona back to the defaults (name, tagline, colour, traits). Likes, dislikes, nicknames, memory and skills stay. */
  reset() {
    Object.assign(this.persona, { name: DEFAULT_PERSONA.name, tagline: DEFAULT_PERSONA.tagline, color: DEFAULT_PERSONA.color, traits: { ...DEFAULT_PERSONA.traits } });
    this.save();
    return this.brief().persona;
  }

  /** A secret move was found (`entity.secret`): remember its name once. True on the first find ever. */
  noteSecret(name) {
    const n = String(name).slice(0, 24);
    if (!SECRET_MOVES.includes(n) || this.profile.secrets.includes(n)) return false;
    this.profile.secrets.push(n);
    this.save();
    return true;
  }

  // ---- special skills ---------------------------------------------------------

  listSkills() {
    let files = [];
    try { files = fs.readdirSync(this.skillsDir).filter((f) => f.endsWith('.md')); } catch { return []; }
    return files.map((f) => parseSkill(path.join(this.skillsDir, f))).filter(Boolean);
  }

  getSkill(name) {
    const file = path.join(this.skillsDir, `${slug(name)}.md`);
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  }

  /**
   * Teach the entity a special skill: a markdown playbook Claude wrote for
   * itself after discovering how to do something new in a unique. Loaded in
   * every future session (names + triggers in the brief; body on demand).
   */
  teach({ name, triggers = [], body, confidence = 0.6, unique = null }) {
    const s = slug(name);
    const file = path.join(this.skillsDir, `${s}.md`);
    const existing = parseSkill(file);
    const uses = existing ? (existing.uses || 0) : 0;
    const fm = [
      '---', `name: ${s}`, `title: ${String(name).replace(/\n/g, ' ')}`,
      `triggers: ${JSON.stringify(triggers)}`, `confidence: ${clamp01(confidence)}`,
      `unique: ${unique || ''}`, `learned: ${existing?.learned || new Date().toISOString()}`,
      `updated: ${new Date().toISOString()}`, `uses: ${uses}`, '---', '',
    ].join('\n');
    fs.writeFileSync(file, fm + String(body).trim() + '\n');
    appendJsonl(this.memoryFile, { ts: this.stamp(), kind: 'skill', text: `learned "${name}"`, weight: 2 });
    return { name: s, file };
  }

  /** Mark a skill as used (bumps confidence a little) or failed (drops it). */
  reinforce(name, ok = true) {
    const file = path.join(this.skillsDir, `${slug(name)}.md`);
    const s = parseSkill(file);
    if (!s) return null;
    const conf = clamp01(s.confidence + (ok ? 0.05 : -0.15));
    let text = fs.readFileSync(file, 'utf8');
    text = text.replace(/^confidence: .*$/m, `confidence: ${conf}`).replace(/^uses: .*$/m, `uses: ${(s.uses || 0) + 1}`);
    fs.writeFileSync(file, text);
    return { name: s.name, confidence: conf };
  }

  forget(name) {
    const file = path.join(this.skillsDir, `${slug(name)}.md`);
    try { fs.unlinkSync(file); return true; } catch { return false; }
  }
}

function parseSkill(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if (k === 'triggers') { try { v = JSON.parse(v); } catch { v = []; } }
      if (k === 'confidence' || k === 'uses') v = Number(v);
      meta[k] = v;
    }
  }
  return { name: meta.name || path.basename(file, '.md'), title: meta.title, triggers: meta.triggers || [], confidence: meta.confidence ?? 0.5, uses: meta.uses || 0, learned: meta.learned, unique: meta.unique, file, body: m ? text.slice(m[0].length) : text };
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'skill';
}

function clamp01(x) { return Math.max(0, Math.min(1, Number(x) || 0)); }
