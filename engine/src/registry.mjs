/**
 * Unique registry: discovers uniques from the bundled folder, the user's
 * ~/.lets/uniques, and the project's .lets/uniques; validates manifests
 * against the LIP schema and the host's safety rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, PLUGIN_ROOT, readJson, isInside } from './paths.mjs';
import { validate } from './validate.mjs';

const RESERVED = new Set(['lip', 'session', 'entity', 'chat', 'component', 'media', 'ui', 'host', 'claude']);
export const LIP_MAJOR = 1;

const schema = readJson(path.join(PLUGIN_ROOT, 'protocol', 'schemas', 'unique.schema.json'));

export function inspectUnique(dir) {
  const manifestPath = path.join(dir, 'unique.json');
  const problems = [];
  const manifest = readJson(manifestPath);
  if (!manifest) return { ok: false, dir, problems: ['unique.json missing or not JSON'] };
  const v = validate(schema, manifest);
  problems.push(...v.errors);
  if (manifest.lip !== LIP_MAJOR) problems.push(`lip major ${manifest.lip} != ${LIP_MAJOR}`);
  for (const d of manifest.domains || []) if (RESERVED.has(d)) problems.push(`reserved domain "${d}"`);
  for (const [kind, map] of [['events', manifest.events], ['commands', manifest.commands]]) {
    for (const t of Object.keys(map || {})) {
      const dom = t.split('.')[0];
      if (!(manifest.domains || []).includes(dom)) problems.push(`${kind}.${t}: domain "${dom}" not declared`);
    }
  }
  const entry = manifest.entry ? path.resolve(dir, manifest.entry) : null;
  if (entry && !isInside(dir, entry)) problems.push('entry escapes the unique folder');
  if (entry && !fs.existsSync(entry)) problems.push(`entry not found: ${manifest.entry}`);
  const guide = manifest.guide ? path.resolve(dir, manifest.guide) : null;
  if (guide && !isInside(dir, guide)) problems.push('guide escapes the unique folder');
  return { ok: problems.length === 0, dir, manifest, problems, entry, guide };
}

export class Registry {
  constructor({ projectDir = process.cwd(), log = () => {} } = {}) {
    this.sources = [
      { kind: 'bundled', dir: path.join(PLUGIN_ROOT, 'uniques') },
      { kind: 'user', dir: DIRS.uniques },
      { kind: 'project', dir: path.join(projectDir, '.lets', 'uniques') },
    ];
    this.log = log;
    this.uniques = new Map();
    this.refresh();
  }

  refresh() {
    this.uniques.clear();
    for (const src of this.sources) {
      let names = [];
      try { names = fs.readdirSync(src.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
      for (const name of names) {
        const dir = path.join(src.dir, name);
        if (!fs.existsSync(path.join(dir, 'unique.json'))) continue;
        const info = inspectUnique(dir);
        const key = info.manifest?.name || name;
        if (!info.ok) { this.log('registry', `skip ${dir}: ${info.problems.join('; ')}`); }
        // later sources (user, project) override bundled ones of the same name only when valid
        if (info.ok || !this.uniques.has(key)) this.uniques.set(key, { ...info, source: src.kind, name: key });
      }
    }
    return this.list();
  }

  list() {
    return [...this.uniques.values()].map((u) => ({
      name: u.name, ok: u.ok, source: u.source, dir: u.dir,
      title: u.manifest?.title, version: u.manifest?.version, description: u.manifest?.description,
      domains: u.manifest?.domains, capabilities: u.manifest?.capabilities, problems: u.problems,
    }));
  }

  get(name) { return this.uniques.get(name) || null; }

  guideText(name) {
    const u = this.get(name);
    if (!u?.guide) return '';
    try { return fs.readFileSync(u.guide, 'utf8'); } catch { return ''; }
  }

  summary(name) {
    const u = this.get(name);
    if (!u) return null;
    const m = u.manifest;
    const ev = Object.entries(m.events || {}).map(([t, d]) => `${t} — ${d.summary}`);
    const cm = Object.entries(m.commands || {}).map(([t, d]) => `${t} — ${d.summary}`);
    return { name: m.name, title: m.title, version: m.version, description: m.description, domains: m.domains, capabilities: m.capabilities, events: ev, commands: cm, permissions: m.permissions || {} };
  }
}
