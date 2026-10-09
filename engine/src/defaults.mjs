/**
 * Default uniques: mediums the engine installs from git when they are missing,
 * listed in defaults.json at the plugin root. The engine itself ships no
 * unique; `graph` is the first default and the documented example.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT, DIRS, readJson } from './paths.mjs';

export function listDefaults() {
  const d = readJson(path.join(PLUGIN_ROOT, 'defaults.json'), { uniques: [] });
  return Array.isArray(d.uniques) ? d.uniques.filter((u) => u && /^[a-z][a-z0-9-]{1,31}$/.test(u.name) && /^(https:\/\/|git@|ssh:\/\/)/.test(u.repo || '')) : [];
}

export function missingDefaults(registry) {
  return listDefaults().filter((u) => !registry.get(u.name)?.ok && !fs.existsSync(path.join(DIRS.uniques, u.name, 'unique.json')));
}

/**
 * Install every missing default (serially; git clones). Returns a report per
 * unique. Never throws: a failed default is reported and the rest continue.
 */
export async function ensureDefaults({ store, registry, log = () => {}, only = null, force = false }) {
  if (process.env.LETS_NO_DEFAULTS === '1') return [];
  const wanted = listDefaults().filter((u) => !only || u.name === only);
  const out = [];
  for (const u of wanted) {
    const present = registry.get(u.name)?.ok || fs.existsSync(path.join(DIRS.uniques, u.name, 'unique.json'));
    if (present && !force) { out.push({ name: u.name, status: 'present' }); continue; }
    try {
      log('defaults', `installing ${u.name} from ${u.repo}`);
      const r = store.install(u.repo, { path: u.path || '', branch: u.ref || '', sha: u.sha || '' });
      if (r.installed) {
        store.installed[r.name] = { ...store.installed[r.name], default: true };
        store.saveInstalled?.();
        out.push({ name: u.name, status: 'installed', version: r.version, sha: r.sha, dir: r.dir });
      } else {
        out.push({ name: u.name, status: 'failed', problems: r.problems || [r.error || 'unknown'] });
      }
    } catch (err) {
      const msg = String(err?.stderr || err?.message || err).split('\n')[0];
      log('defaults', `failed ${u.name}: ${msg}`);
      out.push({ name: u.name, status: 'failed', problems: [msg] });
    }
  }
  registry.refresh();
  return out;
}
