/**
 * Minimal MCP server over stdio (JSON-RPC 2.0, newline-delimited), no SDK.
 * Supports initialize / ping / tools/list / tools/call and ignores the rest
 * gracefully. stdout is the wire; all logging goes to stderr.
 */
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

export class McpServer {
  constructor({ name, version, tools, log = () => {} }) {
    this.name = name; this.version = version; this.log = log;
    this.tools = tools; // [{name, description, inputSchema, handler(args) -> any}]
    this._buf = '';
  }

  start() {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { this._buf += chunk; this._drain(); });
    process.stdin.on('end', () => { this.log('mcp', 'stdin closed'); this.onClose?.(); });
  }

  _drain() {
    let i;
    while ((i = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, i).trim();
      this._buf = this._buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this._send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
      this._handle(msg).catch((err) => this.log('mcp', `handler crashed: ${err.stack || err}`));
    }
  }

  _send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

  async _handle(msg) {
    if (Array.isArray(msg)) { for (const m of msg) await this._handle(m); return; }
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    const reply = (result) => { if (!isNotification) this._send({ jsonrpc: '2.0', id, result }); };
    const fail = (code, message, data) => { if (!isNotification) this._send({ jsonrpc: '2.0', id, error: { code, message, data } }); };
    try {
      switch (method) {
        case 'initialize': {
          const want = params?.protocolVersion;
          const protocolVersion = SUPPORTED.includes(want) ? want : SUPPORTED[0];
          return reply({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: this.name, version: this.version }, instructions: this.instructions || '' });
        }
        case 'notifications/initialized': case 'notifications/cancelled': case 'notifications/roots/list_changed': return;
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case 'tools/call': {
          const tool = this.tools.find((t) => t.name === params?.name);
          if (!tool) return fail(-32602, `unknown tool: ${params?.name}`);
          try {
            const out = await tool.handler(params?.arguments || {});
            const text = typeof out === 'string' ? out : JSON.stringify(out, null, 0);
            return reply({ content: [{ type: 'text', text }], isError: false });
          } catch (err) {
            this.log('mcp', `tool ${tool.name} failed: ${err.stack || err}`);
            return reply({ content: [{ type: 'text', text: `error: ${err.message || err}` }], isError: true });
          }
        }
        case 'resources/list': return reply({ resources: [] });
        case 'prompts/list': return reply({ prompts: [] });
        default:
          if (isNotification) return;
          return fail(-32601, `method not found: ${method}`);
      }
    } catch (err) {
      fail(-32603, String(err.message || err));
    }
  }
}
