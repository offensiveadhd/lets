/**
 * Model router: turns a list of tasks into parallel waves with a model tier
 * per task (cheapest tier that can be trusted with it), and keeps a trust
 * ledger of outcomes per (kind, tier) so routing improves with evidence.
 *
 * Tiers map 1:1 to Claude Code's `Agent` tool `model` values.
 */
import path from 'node:path';
import { DIRS, readJson, writeJson } from './paths.mjs';

export const TIERS = ['haiku', 'sonnet', 'opus'];

/** Relative cost per token (haiku = 1). Keep relative, prices drift. */
const COST_UNITS = { haiku: 1, sonnet: 3, opus: 15 };

/** Priors by task kind: [baseComplexity, baseRisk]. Unknown kinds use [3, 2]. */
const KIND_PRIORS = {
  format: [1, 1], rename: [1, 1], summarize: [2, 1], classify: [1, 1], extract: [2, 1], 'ui-copy': [1, 1],
  lookup: [1, 1], 'test-run': [1, 1], translate: [2, 1], 'commit-msg': [1, 1],
  'code-edit': [3, 2], research: [3, 1], docs: [2, 1], 'test-write': [3, 2], 'refactor-small': [3, 2],
  'review-light': [2, 2], 'ui-build': [3, 2], 'data-shape': [2, 2],
  architecture: [5, 3], security: [4, 5], 'debug-hard': [5, 3], 'refactor-large': [4, 4], design: [4, 2],
  'review-deep': [4, 4], math: [4, 2], 'protocol-design': [5, 3], migration: [4, 5],
};

const SIZE_BUMP = { s: 0, m: 1, l: 2, xl: 3 };
const EST_TOKENS = { s: 4_000, m: 15_000, l: 40_000, xl: 90_000 };

export class Router {
  constructor() {
    this.ledgerFile = path.join(DIRS.router, 'ledger.json');
    this.ledger = readJson(this.ledgerFile, { entries: {}, updated: null });
  }

  save() { this.ledger.updated = new Date().toISOString(); writeJson(this.ledgerFile, this.ledger); }

  /** Record an outcome. `ok` true when the task's result was accepted without a retry. */
  report({ kind = 'unknown', model, ok = true, tokens = null }) {
    if (!TIERS.includes(model)) return null;
    const key = `${kind}:${model}`;
    const e = this.ledger.entries[key] || { tries: 0, ok: 0, tokens: 0 };
    e.tries++; if (ok) e.ok++; if (tokens) e.tokens += tokens;
    this.ledger.entries[key] = e;
    this.save();
    return { key, ...e, rate: e.ok / e.tries };
  }

  trust(kind, tier) {
    const e = this.ledger.entries[`${kind}:${tier}`];
    if (!e || e.tries < 3) return null;
    return e.ok / e.tries;
  }

  /** Pick the tier for one task. Returns {model, score, rationale}. */
  route(task) {
    const kind = task.kind || 'unknown';
    const [pc, pr] = KIND_PRIORS[kind] || [3, 2];
    const complexity = clamp(task.complexity ?? pc, 1, 5);
    const risk = clamp(task.risk ?? pr, 1, 5);
    const size = SIZE_BUMP[task.size] ?? 1;
    let score = complexity + risk * 1.2 + size;
    if (task.needsJudgment) score += 1.5;
    if (task.userFacing) score += 0.5;
    let idx = score <= 5 ? 0 : score <= 10 ? 1 : 2;
    const why = [`complexity ${complexity}`, `risk ${risk}`, `size ${task.size || 'm'}`];
    // evidence: bump up on poor trust, allow down on strong trust at the lower tier
    const t = this.trust(kind, TIERS[idx]);
    if (t !== null && t < 0.6 && idx < 2) { idx++; why.push(`ledger: ${TIERS[idx - 1]} only ${(t * 100) | 0}% ok on "${kind}", bumped`); }
    else if (idx > 0) {
      const lower = this.trust(kind, TIERS[idx - 1]);
      if (lower !== null && lower >= 0.9 && risk <= 3) { idx--; why.push(`ledger: ${TIERS[idx]} ${(lower * 100) | 0}% ok on "${kind}", demoted safely`); }
    }
    if (task.minModel && TIERS.indexOf(task.minModel) > idx) { idx = TIERS.indexOf(task.minModel); why.push(`minModel ${task.minModel}`); }
    const model = TIERS[idx];
    const estTokens = task.estTokens || EST_TOKENS[task.size] || EST_TOKENS.m;
    return { model, score: round(score), rationale: why.join(', '), estTokens, costUnits: round(estTokens / 1000 * COST_UNITS[model]), effort: idx === 2 ? 'high' : idx === 1 ? 'medium' : 'low' };
  }

  /** Topological waves (tasks whose deps are all in earlier waves run in parallel). */
  plan(tasks = []) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const routed = {};
    for (const t of tasks) routed[t.id] = { title: t.title, kind: t.kind, ...this.route(t) };
    const placed = new Map();
    const waves = [];
    let guard = 0;
    while (placed.size < tasks.length && guard++ < 100) {
      const wave = tasks.filter((t) => !placed.has(t.id) && (t.depends || []).every((d) => placed.has(d) || !byId.has(d))).map((t) => t.id);
      if (!wave.length) { // cycle: dump the rest
        waves.push(tasks.filter((t) => !placed.has(t.id)).map((t) => t.id));
        break;
      }
      for (const id of wave) placed.set(id, waves.length);
      waves.push(wave);
    }
    const totalTokens = Object.values(routed).reduce((a, r) => a + r.estTokens, 0);
    const totalUnits = Object.values(routed).reduce((a, r) => a + r.costUnits, 0);
    const allOpus = round(totalTokens / 1000 * COST_UNITS.opus);
    return {
      waves, tasks: routed,
      budget: { estTokens: totalTokens, costUnits: round(totalUnits), vsAllOpusUnits: allOpus, savingsPct: allOpus ? Math.round((1 - totalUnits / allOpus) * 100) : 0 },
      howTo: 'Spawn each wave with the Agent tool in one message (parallel); pass model=<tier>; after each result call plan.report {kind, model, ok}.',
    };
  }
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, Number(x) || lo)); }
function round(x) { return Math.round(x * 10) / 10; }
