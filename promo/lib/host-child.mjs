// The engine, as a child process of the recorder. rig.mjs forks this with LETS_HOME pointing at a throwaway
// folder, so nothing here touches the person's ~/.lets. The parent reaches the engine's own tools over IPC:
// the same handlers the MCP server gives Claude (open, listen, send, say, query, entity, sessions, run),
// which is how the recorder plays Claude's side without a second implementation of it.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// PROMO_ENGINE names another checkout that carries an engine/ (a vendored copy, say); the default is this one
const root = process.env.PROMO_ENGINE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createEngine } = await import(pathToFileURL(path.join(root, 'engine', 'src', 'engine.mjs')).href);

const engine = await createEngine({ port: Number(process.env.PROMO_PORT) || undefined, projectDir: process.env.PROMO_PROJECT || process.cwd(), log: () => {} });

process.on('message', async (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.stop) { engine.stop(); process.exit(0); }
  try {
    let result;
    if (m.tool) {
      const t = engine.tools.find((x) => x.name === m.tool);
      if (!t) throw new Error(`no tool "${m.tool}"`);
      result = await t.handler(m.args || {});
    } else if (m.windows) {
      result = engine.host.bus.windowList();
    } else throw new Error('unknown request');
    process.send({ id: m.id, result });
  } catch (err) { process.send({ id: m.id, error: String(err?.message || err) }); }
});

process.send({
  ready: true, origin: engine.host.origin, port: engine.host.port, token: engine.host.token,
  uniques: engine.host.registry.list().map((u) => ({ name: u.name, ok: u.ok, version: u.version, problems: u.problems })),
});
