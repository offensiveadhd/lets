/** Wires host + entity + router + store + tools into one engine instance. */
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, ensureDirs } from './paths.mjs';
import { Host } from './host.mjs';
import { Entity } from './entity.mjs';
import { Router } from './router.mjs';
import { Store } from './store.mjs';
import { buildTools } from './tools.mjs';
import { ensureDefaults, missingDefaults } from './defaults.mjs';

export function makeLogger(name = 'lets') {
  ensureDirs();
  const file = path.join(DIRS.logs, `${name}-${new Date().toISOString().slice(0, 10)}.log`);
  return (scope, msg) => {
    const line = `${new Date().toISOString()} [${scope}] ${msg}\n`;
    try { fs.appendFileSync(file, line); } catch { /* ignore */ }
    if (process.env.LETS_DEBUG) process.stderr.write(line);
  };
}

export async function createEngine({ projectDir = process.cwd(), port, log = makeLogger() } = {}) {
  ensureDirs();
  const entity = new Entity();
  const router = new Router();
  const store = new Store({ log });
  const host = new Host({ log, projectDir, entity });
  await host.start(port);
  const defaults = { missing: missingDefaults(host.registry), promise: null, report: null };
  /** Install missing default uniques (graph, …) once; concurrent callers share the same promise. */
  const provision = (opts = {}) => {
    if (!defaults.promise || opts.force) {
      defaults.promise = ensureDefaults({ store, registry: host.registry, log, ...opts }).then((r) => { defaults.report = r; defaults.missing = missingDefaults(host.registry); return r; });
    }
    return defaults.promise;
  };
  const tools = buildTools({ host, entity, router, store, log, provision });
  if (defaults.missing.length && process.env.LETS_NO_DEFAULTS !== '1') {
    log('defaults', `missing: ${defaults.missing.map((u) => u.name).join(', ')} — installing in the background`);
    provision().catch(() => {});
  }
  const stop = () => { try { host.stop(); } catch { /* ignore */ } };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stop(); process.exit(0); });
  process.on('exit', stop);
  return { host, entity, router, store, tools, log, stop, provision, defaults };
}
