/** Wires host + entity + router + store + tools into one engine instance. */
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, ensureDirs } from './paths.mjs';
import { Host } from './host.mjs';
import { Entity } from './entity.mjs';
import { Router } from './router.mjs';
import { Store } from './store.mjs';
import { buildTools } from './tools.mjs';

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
  const tools = buildTools({ host, entity, router, store, log });
  const stop = () => { try { host.stop(); } catch { /* ignore */ } };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stop(); process.exit(0); });
  process.on('exit', stop);
  return { host, entity, router, store, tools, log, stop };
}
