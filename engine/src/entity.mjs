/**
 * The companion entity: a persisted persona, a memory of observations, a
 * learned interaction profile, and "special skills" Claude teaches itself.
 * Everything lives under ~/.lets/entity so it survives sessions and plugin updates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, readJson, writeJson, appendJsonl } from './paths.mjs';

const DEFAULT_PERSONA = {
  name: 'Pip',
  born: null,
  tagline: 'small, bright, eager to help',
  traits: { speed: 0.55, distance: 0.5, chatty: 0.5, playful: 0.65, formality: 0.2, curiosity: 0.8 },
  color: '#a66bff',
  mood: 'idle',
  version: 1,
  sessions: 0,
  likes: [],      // learned user likes ("short labels", "tree layouts")
  dislikes: [],
  nicknames: {},  // what the user calls things
};

const DEFAULT_PROFILE = {
  pace: null, clickRate: null, dwell: null, regions: null, idleMs: null,
  sessionsSeen: 0, summons: 0, picks: 0, dismisses: 0, lastSeen: null,
};

export class Entity {
  constructor() {
    this.personaFile = path.join(DIRS.entity, 'persona.json');
    this.profileFile = path.join(DIRS.entity, 'profile.json');
    this.memoryFile = path.join(DIRS.entity, 'memory.jsonl');
    this.skillsDir = DIRS.entitySkills;
    fs.mkdirSync(this.skillsDir, { recursive: true });
    this.persona = { ...DEFAULT_PERSONA, ...(readJson(this.personaFile) || {}) };
    if (!this.persona.born) this.persona.born = new Date().toISOString();
    this.profile = { ...DEFAULT_PROFILE, ...(readJson(this.profileFile) || {}) };
    this.persona.sessions = (this.persona.sessions || 0) + 1;
    this.profile.sessionsSeen = (this.profile.sessionsSeen || 0) + 1;
    this.save();
  }

  save() {
    writeJson(this.personaFile, this.persona);
    writeJson(this.profileFile, this.profile);
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
      profile: { pace: this.profile.pace, clickRate: this.profile.clickRate, dwell: this.profile.dwell, regions: this.profile.regions, summons: this.profile.summons, picks: this.profile.picks },
      skills: skills.map((s) => ({ name: s.name, triggers: s.triggers, confidence: s.confidence })),
      recentMemory: recent,
    };
  }

  // ---- learning -------------------------------------------------------------

  /** Record an observation (from Claude or from an entity.profile event). */
  learn({ kind = 'note', text, weight = 1, traits = null, likes = [], dislikes = [], nicknames = {}, mood = null } = {}) {
    if (text) appendJsonl(this.memoryFile, { ts: Date.now(), kind, text: String(text).slice(0, 400), weight });
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

  rename(name) { this.persona.name = String(name).slice(0, 24); this.save(); return this.persona.name; }

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
    appendJsonl(this.memoryFile, { ts: Date.now(), kind: 'skill', text: `learned "${name}"`, weight: 2 });
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
