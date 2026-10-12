#!/usr/bin/env node
/**
 * MCP entry point: `node engine/bin/lets-mcp.mjs`
 * Claude Code spawns this over stdio; it starts the loopback host lazily on
 * first use and tears it down when stdin closes.
 */
import { createEngine, makeLogger } from '../src/engine.mjs';
import { McpServer } from '../src/mcp.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const log = makeLogger('mcp');

const engine = await createEngine({ projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(), log });
const server = new McpServer({ name: 'lets', version: pkg.version, tools: engine.tools, log });
server.instructions = [
  'lets: talk to the human through interactive windows (uniques).',
  'Flow: open → (open the URL in a browser pane) → listen/query for what the human did → send/say to react.',
  `Host: ${engine.host.origin}. Uniques: ${engine.host.registry.list().map((u) => u.name).join(', ') || 'none'}.`,
].join(' ');
server.onClose = () => { engine.stop(); process.exit(0); };

// Channel bridge: when loaded as a Claude Code channel (CLI `--channels` / development channels), the
// human's meaningful acts in a window wake Claude as messages. Skipped while Claude is already blocked
// in `listen` (those events arrive through the tool result instead), so nothing is delivered twice.
const WAKE = new Set(['chat.message', 'graph.ask', 'graph.export', 'media.image', 'media.file', 'component.action', 'entity.pick']);
const bus = engine.host.bus;
const pushOrig = bus.push.bind(bus);
bus.push = (msg) => {
  const ok = pushOrig(msg);
  if (ok && WAKE.has(msg?.type) && !bus.listening && process.env.LETS_CHANNEL !== '0') {
    const data = JSON.stringify(msg.data ?? {});
    const hint = msg.data?.session?.handoff
      ? '(This is a "Send to Claude" handoff: the window is closing itself. Answer in the transcript, label the session with the sessions tool; later open {resume} brings it back.)'
      : '(React per the unique\'s guide; answer in the window with the lets tools. Call lets listen to drain anything else.)';
    const body = `${msg.type} from window ${String(msg.from).replace(/^unique:/, '')}:\n${data.length > 4000 ? data.slice(0, 4000) + '…' : data}\n${hint}`;
    server.channel(body, { window: String(msg.from).split('#')[1] || '', type: msg.type, event_id: msg.id });
  }
  return ok;
};

server.start();
log('mcp', `ready, host ${engine.host.origin}`);
