/**
 * The community store: uniques shared through git.
 *
 * A *store* is a git repo holding `index.json` (schema: protocol/schemas/store-index.schema.json)
 * that lists uniques by git URL (+ optional path/ref/sha/manifest hash). Installing clones the
 * unique's repo, validates its manifest against the LIP rules and copies the unique folder to
 * ~/.lets/uniques/<name>. Nothing from a unique is ever executed server-side.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DIRS, PLUGIN_ROOT, readJson, writeJson, isInside } from './paths.mjs';
import { validate } from './validate.mjs';
import { inspectUnique } from './registry.mjs';
import { sha256 } from './ids.mjs';

const DEFAULT_STORES = [{ name: 'lets-store', repo: 'https://github.com/TikoTikTok/lets-store.git' }];
const NAME_RE = /^[a-z][a-z0-9-]{1,31}$/;
const indexSchema = readJson(path.join(PLUGIN_ROOT, 'protocol', 'schemas', 'store-index.schema.json'));

function git(args, cwd, timeout = 60_000) {
  return execFileSync('git', args, { cwd, timeout, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
}

export class Store {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.configFile = path.join(DIRS.home, 'config.json');
    this.config = readJson(this.configFile, { stores: DEFAULT_STORES });
    if (!this.config.stores?.length) this.config.stores = DEFAULT_STORES;
    this.installedFile = path.join(DIRS.uniques, '.installed.json');
    this.installed = readJson(this.installedFile, {});
  }

  stores() { return this.config.stores; }

  addStore(name, repo) {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(name)) throw new Error('bad store name');
    this.config.stores = this.config.stores.filter((s) => s.name !== name).concat([{ name, repo }]);
    writeJson(this.configFile, this.config);
    return this.config.stores;
  }

  /** Clone or pull every configured store; returns their indexes. */
  sync() {
    const out = [];
    for (const s of this.config.stores) {
      const dir = path.join(DIRS.stores, s.name);
      try {
        if (fs.existsSync(path.join(dir, '.git'))) git(['pull', '--ff-only', '-q'], dir);
        else { fs.mkdirSync(DIRS.stores, { recursive: true }); git(['clone', '--depth', '1', '-q', s.repo, dir], DIRS.stores, 120_000); }
        const idx = readJson(path.join(dir, 'index.json'));
        const v = idx ? validate(indexSchema, idx) : { ok: false, errors: ['index.json missing'] };
        out.push({ store: s.name, repo: s.repo, ok: v.ok, problems: v.errors, uniques: v.ok ? idx.uniques.length : 0 });
      } catch (err) {
        out.push({ store: s.name, repo: s.repo, ok: false, problems: [String(err.stderr || err.message).split('\n')[0]] });
      }
    }
    return out;
  }

  entries() {
    const all = [];
    for (const s of this.config.stores) {
      const idx = readJson(path.join(DIRS.stores, s.name, 'index.json'));
      if (!idx?.uniques) continue;
      for (const u of idx.uniques) all.push({ ...u, store: s.name, installed: !!this.installed[u.name] });
    }
    return all;
  }

  search(query = '') {
    const q = String(query).toLowerCase().trim();
    return this.entries().filter((u) => !q || [u.name, u.title, u.description, ...(u.tags || [])].join(' ').toLowerCase().includes(q))
      .map((u) => ({ name: u.name, title: u.title, description: u.description, store: u.store, verified: !!u.verified, tags: u.tags, installed: u.installed, repo: u.repo }));
  }

  /**
   * Fetch a unique into a staging dir and validate it. Does not enable it.
   * `ref` may be a store entry name or a git URL.
   */
  inspect(ref, { path: subPath = '', branch = '', sha = '' } = {}) {
    const entry = this.entries().find((u) => u.name === ref);
    const repo = entry?.repo || ref;
    if (!/^(https:\/\/|git@|ssh:\/\/)/.test(repo)) throw new Error(`"${ref}" is not a store entry or a git URL`);
    subPath = subPath || entry?.path || '';
    branch = branch || entry?.ref || '';
    sha = sha || entry?.sha || '';
    const stage = path.join(DIRS.stores, '_staging', sha256(repo + subPath).slice(0, 12));
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    const cloneArgs = ['clone', '-q', ...(sha ? [] : ['--depth', '1']), ...(branch ? ['--branch', branch] : []), repo, stage];
    git(cloneArgs, DIRS.stores, 180_000);
    if (sha) git(['checkout', '-q', sha], stage);
    const head = git(['rev-parse', 'HEAD'], stage);
    const udir = path.join(stage, subPath);
    const info = inspectUnique(udir);
    const problems = [...info.problems];
    if (entry?.sha && !head.startsWith(entry.sha)) problems.push(`HEAD ${head.slice(0, 7)} != pinned ${entry.sha.slice(0, 7)}`);
    let manifestSha = null;
    try { manifestSha = sha256(fs.readFileSync(path.join(udir, 'unique.json'))); } catch { /* reported above */ }
    if (entry?.manifestSha256 && manifestSha && manifestSha !== entry.manifestSha256) problems.push('manifest hash differs from the store index');
    const files = walk(udir).filter((f) => !f.includes(`${path.sep}.git${path.sep}`));
    const suspicious = files.filter((f) => /\.(exe|dll|sh|ps1|bat|cmd|py|rb|php)$/i.test(f));
    if (suspicious.length) problems.push(`executable-looking files: ${suspicious.slice(0, 5).map((f) => path.relative(udir, f)).join(', ')}`);
    const m = info.manifest || {};
    return {
      ok: problems.length === 0, stage: udir, repo, sha: head, name: m.name, title: m.title, version: m.version, description: m.description,
      domains: m.domains, capabilities: m.capabilities, permissions: m.permissions || {}, files: files.length, problems,
      verified: !!entry?.verified, manifestSha256: manifestSha,
    };
  }

  /** Copy a validated staging dir into ~/.lets/uniques/<name>. Call after inspect() and after the user confirmed. */
  install(ref, opts = {}) {
    const i = this.inspect(ref, opts);
    if (!i.ok && !opts.force) return { installed: false, ...i, hint: 'fix the problems or pass force:true after the user explicitly accepts them' };
    const dest = path.join(DIRS.uniques, i.name);
    fs.rmSync(dest, { recursive: true, force: true });
    copyDir(i.stage, dest, (rel) => !rel.startsWith('.git'));   // .git* at the top level; copyDir drops nested .git and symlinks
    this.installed[i.name] = { repo: i.repo, sha: i.sha, version: i.version, installedAt: new Date().toISOString(), manifestSha256: i.manifestSha256, path: opts.path || '' };
    writeJson(this.installedFile, this.installed);
    fs.rmSync(path.dirname(i.stage) === path.join(DIRS.stores, '_staging') ? i.stage : path.join(DIRS.stores, '_staging'), { recursive: true, force: true });
    return { installed: true, name: i.name, dir: dest, version: i.version, sha: i.sha };
  }

  remove(name) {
    if (!NAME_RE.test(String(name))) return { removed: false, reason: 'bad unique name' };
    const dest = path.join(DIRS.uniques, name);
    if (!isInside(DIRS.uniques, dest)) return { removed: false, reason: 'bad unique name' };
    if (!this.installed[name] && !fs.existsSync(dest)) return { removed: false, reason: 'not installed' };
    fs.rmSync(dest, { recursive: true, force: true });
    delete this.installed[name];
    writeJson(this.installedFile, this.installed);
    return { removed: true, name };
  }

  update(name) {
    if (!NAME_RE.test(String(name))) return { updated: false, reason: 'bad unique name' };
    const rec = this.installed[name];
    if (!rec) return { updated: false, reason: 'not installed' };
    return { updated: true, ...this.install(rec.repo, { path: rec.path }) };
  }

  listInstalled() { return Object.entries(this.installed).map(([name, r]) => ({ name, ...r })); }

  saveInstalled() { writeJson(this.installedFile, this.installed); }
}

function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') walk(p, out); } else out.push(p);
  }
  return out;
}

/** Copy a unique folder: regular files and directories only (symlinks are skipped, `.git` at any depth is dropped). */
export function copyDir(src, dest, filter = () => true) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = e.name;
    if (rel === '.git' || !filter(rel)) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isSymbolicLink()) continue;                      // never copy (and later serve) something that points elsewhere
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}
