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
server.start();
log('mcp', `ready, host ${engine.host.origin}`);
