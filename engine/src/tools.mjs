/**
 * The MCP tools Claude uses to drive lets. Names are short; Claude Code
 * exposes them as mcp__plugin_lets_lets__<name> (or mcp__lets__<name> when
 * the server is registered directly).
 */
import { spawn } from 'node:child_process';
import { rid } from './ids.mjs';
import { matchType } from './bus.mjs';

// Claude Code's MCP tool timeout is hours, but a call running past ~2 minutes may be moved to a
// background task, so one listen stays under that: 100 s max, 90 s is what the skill uses.
const MAX_WAIT = 100_000;

export function buildTools({ host, entity, router, store, sessions = null, log, provision = async () => [] }) {
  const bus = host.bus;

  // Up-events pass through here before the ring buffer:
  //  - entity.profile folds into the persisted profile; entity.secret is remembered;
  //  - a unique's *export* event ("Send to Claude") is saved as a session, marked
  //    `data.session = {id, handoff:true}` and, unless config says `handoff:"stay"`,
  //    the window is told to close itself (`session.close`) so Claude answers in
  //    the transcript. A *snapshot* reply silently refreshes the saved session.
  const origPush = bus.push.bind(bus);
  bus.push = (msg) => {
    const role = sessions ? sessions.roleOf(msg) : null;
    if (role) {
      try {
        const rec = sessions.save(msg, { role });
        if (rec && role === 'export') {
          const closing = sessions.handoff === 'close';
          msg.data = { session: { id: rec.id, handoff: closing, saved: true, summary: rec.summary }, ...(msg.data || {}) };
          if (closing) {
            const w = String(msg.from).split('#')[1];
            bus.send({ type: 'session.close', data: { reason: 'handoff', text: 'Sent to Claude ✦ see you in Claude Code', ms: 1400 }, from: 'host' }, w);
            log('sessions', `handoff ${rec.unique}#${w} -> session ${rec.id}; window told to close`);
          }
        } else if (rec) msg.data = { session: { id: rec.id, saved: true }, ...(msg.data || {}) };
      } catch (err) { log('sessions', String(err?.stack || err)); }
    }
    const ok = origPush(msg);
    if (ok && msg?.type === 'entity.profile') { try { entity.absorbProfile(msg.data || {}); } catch (err) { log('entity', String(err)); } }
    if (ok && msg?.type === 'entity.secret' && msg.data?.name) { try { entity.learn({ kind: 'secret', text: `the human found Pip's secret move "${String(msg.data.name).slice(0, 24)}"` }); } catch (err) { log('entity', String(err)); } }
    return ok;
  };

  const compact = (ev) => ({ id: ev.id, t: ev.type, from: ev.from.replace(/^unique:/, ''), ts: ev.ts, data: ev.data, ...(ev.re ? { re: ev.re } : {}) });

  const tools = [
    {
      name: 'open',
      description: 'Open a unique (interactive window) and get its URL, guide, the companion brief and the recent saved sessions. resume:"last" (or a session id from the list) brings a board the human sent earlier back into the new window. Opens nothing by itself unless launch="system" (default browser); in the Claude desktop app open the URL with the built-in browser tools instead.',
      inputSchema: {
        type: 'object',
        properties: {
          unique: { type: 'string', description: 'unique name, e.g. "graph"' },
          args: { type: 'object', description: 'optional key/values passed to the window in the URL hash' },
          launch: { type: 'string', enum: ['none', 'system'], description: 'none (default): just return the URL. system: open in the OS default browser.' },
          windowId: { type: 'string', description: 'reuse a window id (reconnect) instead of creating a new one' },
          brief: { type: 'boolean', description: 'include the companion/entity brief (default true)' },
          resume: { type: 'string', description: '"last" = the newest saved session of this unique (this project first), or a session id / id prefix: the window is rebuilt from what the human last sent to Claude' },
        },
        required: ['unique'],
      },
      async handler({ unique, args = {}, launch = 'none', windowId, brief = true, resume = null }) {
        host.registry.refresh();
        let u = host.registry.get(unique);
        if (!u) {
          // a default unique (graph, …) that is not installed yet: install it now, then continue
          const report = await provision();
          const mine = report.find((r) => r.name === unique);
          host.registry.refresh();
          u = host.registry.get(unique);
          if (!u) return { error: `unknown unique "${unique}"`, available: host.registry.list().map((x) => x.name), defaults: report, hint: mine?.status === 'failed' ? `default "${unique}" could not be installed: ${(mine.problems || []).join('; ')} (needs git and access to the repo)` : 'install it from the store or add it under ~/.lets/uniques' };
        }
        if (!u.ok) return { error: `unique "${unique}" is invalid`, problems: u.problems };
        const { url, windowId: w } = host.windowUrl(unique, { windowId, args });
        let resumed = null;
        if (resume && sessions) {
          const rec = sessions.get(unique, resume);
          if (!rec) resumed = { error: `no saved session "${resume}" for ${unique}` };
          else {
            const cmd = sessions.restoreCommand(rec);
            // queued now, delivered the moment the window attaches (before anything else)
            bus.send({ ...cmd, from: 'host' }, w);
            sessions.byWindow.set(w, rec.id);
            resumed = { id: rec.id, at: rec.at, label: rec.label, summary: rec.summary, restore: cmd.type };
          }
        }
        if (launch === 'system') openSystem(url, log);
        return {
          url, windowId: w, unique, origin: host.origin,
          howToOpen: launch === 'system' ? 'opened in the default browser' : 'Open this URL in the built-in browser pane (preview_start/navigate) or pass launch:"system".',
          resumed,
          sessions: sessions ? sessions.list({ unique, limit: 5 }).map((s) => ({ id: s.id, at: s.at, label: s.label, summary: s.summary, project: s.project })) : [],
          handoff: sessions ? sessions.handoff : 'stay',
          summary: host.registry.summary(unique),
          guide: host.registry.guideText(unique),
          entity: brief ? entity.brief() : undefined,
        };
      },
    },
    {
      name: 'listen',
      description: 'Read events the human produced in open windows (selections, exports, chat messages, pasted images, entity clicks...). Non-blocking by default; set wait_ms to block until something happens (max 100000; the attentive loop uses 90000). Events are compact; big payloads (images) arrive as file paths you can Read.',
      inputSchema: {
        type: 'object',
        properties: {
          wait_ms: { type: 'integer', minimum: 0, maximum: MAX_WAIT, description: 'block up to this long for the first event (default 0; the attentive loop uses 90000)' },
          max: { type: 'integer', minimum: 1, maximum: 200, description: 'max events to return (default 50)' },
          types: { type: 'array', items: { type: 'string' }, description: 'only these types; "graph.*" wildcards allowed' },
          cursor: { type: 'string', description: 'named cursor (default "claude")' },
        },
      },
      async handler({ wait_ms = 0, max = 50, types = null, cursor = 'claude' }) {
        if (cursor === 'claude') bus.touchListening(wait_ms > 0 ? 8000 : 3000);
        const waited = await bus.wait(cursor, Math.min(wait_ms, MAX_WAIT));
        const r = bus.read(cursor, { max, types });
        return { events: r.events.map(compact), cursor: r.cursor, pending: r.pending, timedOut: wait_ms > 0 && !waited && r.events.length === 0, windows: bus.windowList().map((w) => ({ id: w.id, unique: w.unique, connected: w.connected })) };
      },
    },
    {
      name: 'send',
      description: 'Send LIP commands to a window: graph edits (graph.node.add, graph.highlight...), entity actions (entity.say, entity.mood, entity.suggest, entity.move), chat (chat.say), components (component.create/update/remove), ui.toast. Batch several in one call.',
      inputSchema: {
        type: 'object',
        properties: {
          commands: {
            type: 'array', minItems: 1,
            items: { type: 'object', required: ['type'], properties: { type: { type: 'string' }, data: {}, to: { type: 'string' }, ack: { type: 'boolean' }, ttl: { type: 'integer' } } },
          },
          to: { type: 'string', description: 'default target: windowId or "unique:<name>"; omitted = every open window' },
          ack: { type: 'boolean', description: 'wait for the window to acknowledge each command (default false)' },
        },
        required: ['commands'],
      },
      async handler({ commands, to, ack = false }) {
        const results = [];
        for (const c of commands) {
          if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$/.test(c.type)) { results.push({ type: c.type, error: 'bad type' }); continue; }
          const cmd = { type: c.type, data: c.data ?? {}, ttl: c.ttl };
          const target = c.to || to;
          results.push(ack || c.ack ? await bus.sendAck(cmd, target) : bus.send(cmd, target));
        }
        return { results, windows: bus.windowList().filter((w) => w.connected).map((w) => w.id) };
      },
    },
    {
      name: 'say',
      description: 'Talk to the human in the window: through the chat panel ("chat"), the companion speech bubble ("entity"), or both. Use stream_id + done:false for streamed chunks.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          via: { type: 'string', enum: ['chat', 'entity', 'both'], description: 'default chat' },
          mood: { type: 'string', enum: ['idle', 'happy', 'curious', 'thinking', 'busy', 'proud', 'sleepy', 'alert'] },
          to: { type: 'string' },
          stream_id: { type: 'string', description: 'group chunks of one streamed message' },
          done: { type: 'boolean', description: 'false while streaming; true/omitted ends the message' },
          open_chat: { type: 'boolean', description: 'open the chat panel first (default true for via=chat)' },
        },
        required: ['text'],
      },
      async handler({ text, via = 'chat', mood, to, stream_id, done = true, open_chat }) {
        const out = [];
        if (mood) out.push(bus.send({ type: 'entity.mood', data: { mood } }, to));
        if (via === 'chat' || via === 'both') {
          if (open_chat ?? true) out.push(bus.send({ type: 'chat.open', data: {} }, to));
          out.push(bus.send({ type: 'chat.say', data: { text, done }, re: stream_id, done }, to));
        }
        if (via === 'entity' || via === 'both') out.push(bus.send({ type: 'entity.say', data: { text: text.slice(0, 280), mood } }, to));
        return { delivered: out.map((r) => r.delivered).flat(), queued: out.map((r) => r.queued).flat() };
      },
    },
    {
      name: 'query',
      description: 'Send one command and wait for the window\'s reply event (e.g. type "graph.snapshot" → reply "graph.snapshot" returns the whole graph JSON). Use it to read the current state of a board before reasoning about it.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string' }, data: {}, reply: { type: 'string', description: 'reply event type (default = same as type)' },
          to: { type: 'string' }, timeout_ms: { type: 'integer', minimum: 100, maximum: MAX_WAIT },
        },
        required: ['type'],
      },
      async handler({ type, data = {}, reply, to, timeout_ms = 8000 }) {
        const replyType = reply || type;
        const sent = bus.send({ type, data }, to);
        if (!sent.delivered.length) return { error: 'no connected window', queued: sent.queued };
        const cursor = `q_${rid('x')}`;
        bus.cursors.set(cursor, bus.seq);
        const deadline = Date.now() + Math.min(timeout_ms, MAX_WAIT);
        while (Date.now() < deadline) {
          await bus.wait(cursor, deadline - Date.now());
          const r = bus.read(cursor, { max: 200 });
          const hit = r.events.find((e) => matchType(replyType, e.type) && (!to || e.from.endsWith(`#${to}`) || to.startsWith('unique:')));
          if (hit) { bus.cursors.delete(cursor); return { reply: compact(hit) }; }
        }
        bus.cursors.delete(cursor);
        return { error: 'timeout waiting for reply', replyType };
      },
    },
    {
      name: 'state',
      description: 'Inspect the engine: open windows, host info, uploads this session, installed uniques, saved sessions, or the companion.',
      inputSchema: { type: 'object', properties: { what: { type: 'string', enum: ['windows', 'host', 'uploads', 'uniques', 'sessions', 'entity', 'all'] } } },
      async handler({ what = 'all' }) {
        const parts = {
          windows: () => bus.windowList(),
          host: () => ({ origin: host.origin, port: host.port, pid: process.pid, stats: bus.stats, cursors: Object.fromEntries(bus.cursors), runFile: host.runFile, handoff: sessions?.handoff }),
          uploads: () => host.uploads,
          uniques: () => host.registry.refresh(),
          sessions: () => (sessions ? sessions.list({ limit: 10 }) : []),
          entity: () => entity.brief(),
        };
        if (what !== 'all') return parts[what]();
        return Object.fromEntries(Object.entries(parts).map(([k, f]) => [k, f()]));
      },
    },
    {
      name: 'uniques',
      description: 'List available uniques (default/installed, project-local, extra dirs), show one in detail (manifest summary + guide), rescan the folders, or install the missing default uniques (graph, …) from git.',
      inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'info', 'refresh', 'defaults'] }, name: { type: 'string' }, force: { type: 'boolean', description: 'defaults: reinstall even if present' } } },
      async handler({ action = 'list', name, force = false }) {
        if (action === 'refresh') return host.registry.refresh();
        if (action === 'defaults') return { report: await provision({ force, only: name || null }), uniques: host.registry.list().map((x) => x.name) };
        if (action === 'info') return name ? { summary: host.registry.summary(name), guide: host.registry.guideText(name), problems: host.registry.get(name)?.problems } : { error: 'name required' };
        return host.registry.list();
      },
    },
    {
      name: 'store',
      description: 'The community store (git). sync pulls store indexes; search finds uniques; inspect fetches one into staging and validates it (show the human its permissions/problems and ask before installing); install copies it into ~/.lets/uniques after confirmation; remove/update manage installed ones; stores/add_store manage store repos.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['sync', 'search', 'inspect', 'install', 'remove', 'update', 'installed', 'stores', 'add_store'] },
          query: { type: 'string' }, name: { type: 'string', description: 'store entry name or git URL' },
          path: { type: 'string', description: 'sub-folder inside the repo holding unique.json' }, ref: { type: 'string', description: 'branch/tag' }, sha: { type: 'string' },
          confirm: { type: 'boolean', description: 'install: the human explicitly agreed after seeing inspect()' }, force: { type: 'boolean' },
          repo: { type: 'string', description: 'add_store: git URL' },
        },
        required: ['action'],
      },
      async handler(a) {
        switch (a.action) {
          case 'sync': return store.sync();
          case 'search': return store.search(a.query || '');
          case 'inspect': return store.inspect(a.name, { path: a.path, branch: a.ref, sha: a.sha });
          case 'install': {
            if (!a.confirm) return { installed: false, error: 'confirm:true required — show the human the inspect() summary (permissions, problems, verified flag) and ask first.' };
            const r = store.install(a.name, { path: a.path, branch: a.ref, sha: a.sha, force: a.force });
            host.registry.refresh();
            return r;
          }
          case 'remove': { const r = store.remove(a.name); host.registry.refresh(); return r; }
          case 'update': { const r = store.update(a.name); host.registry.refresh(); return r; }
          case 'installed': return store.listInstalled();
          case 'stores': return store.stores();
          case 'add_store': return store.addStore(a.name, a.repo);
          default: return { error: 'unknown action' };
        }
      },
    },
    {
      name: 'sessions',
      description: 'Saved sessions: what the human handed to Claude from a window ("Send to Claude") so it can come back later with open {resume}. list (recent, per unique or all), get (one, with its payload), label (give it a short title so it can be found by what the human asks for), remove.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'label', 'remove'] },
          unique: { type: 'string', description: 'filter / target unique (e.g. "graph")' },
          id: { type: 'string', description: 'session id (or prefix), or "last"' },
          label: { type: 'string', description: 'label: the short title (<= 80 chars)' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['action'],
      },
      async handler({ action, unique, id, label, limit = 10 }) {
        if (!sessions) return { error: 'sessions unavailable' };
        switch (action) {
          case 'list': return sessions.list({ unique: unique || null, limit });
          case 'get': { if (!unique) return { error: 'unique required' }; const r = sessions.get(unique, id || 'last'); return r || { error: 'not found' }; }
          case 'label': { if (!unique || !id) return { error: 'unique and id required' }; return sessions.label(unique, id, label) || { error: 'not found' }; }
          case 'remove': { if (!unique || !id) return { error: 'unique and id required' }; return { removed: sessions.remove(unique, id) }; }
          default: return { error: 'unknown action' };
        }
      },
    },
    {
      name: 'entity',
      description: 'The companion ("you"): brief (persona + learned profile + skill index), learn (record an observation / adjust traits / likes / nicknames), teach (write a SPECIAL SKILL markdown playbook for future sessions), skills/skill (list/read), reinforce (skill worked / failed), forget, mood, rename.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['brief', 'learn', 'teach', 'skills', 'skill', 'reinforce', 'forget', 'mood', 'rename', 'profile'] },
          text: { type: 'string', description: 'learn: the observation' }, kind: { type: 'string', description: 'learn: note|preference|habit|request|style' },
          traits: { type: 'object', description: 'learn: partial {speed,distance,chatty,playful,formality,curiosity} 0..1' },
          likes: { type: 'array', items: { type: 'string' } }, dislikes: { type: 'array', items: { type: 'string' } }, nicknames: { type: 'object' },
          name: { type: 'string', description: 'teach/skill/reinforce/forget: skill name; rename: new companion name' },
          triggers: { type: 'array', items: { type: 'string' }, description: 'teach: phrases/situations that should recall this skill' },
          body: { type: 'string', description: 'teach: the playbook (markdown): when, steps, commands to send, pitfalls' },
          confidence: { type: 'number' }, unique: { type: 'string' }, ok: { type: 'boolean' }, mood: { type: 'string' },
        },
        required: ['action'],
      },
      async handler(a) {
        switch (a.action) {
          case 'brief': return entity.brief();
          case 'profile': return entity.profile;
          case 'learn': return entity.learn(a);
          case 'teach': {
            if (!a.name || !a.body) return { error: 'name and body required' };
            const r = entity.teach(a);
            bus.send({ type: 'entity.say', data: { text: `I just learned **${a.name}** ✨`, mood: 'proud' } });
            return r;
          }
          case 'skills': return entity.listSkills().map((s) => ({ name: s.name, title: s.title, triggers: s.triggers, confidence: s.confidence, uses: s.uses, unique: s.unique }));
          case 'skill': return { name: a.name, body: entity.getSkill(a.name) };
          case 'reinforce': return entity.reinforce(a.name, a.ok ?? true);
          case 'forget': return { forgotten: entity.forget(a.name) };
          case 'mood': { entity.setMood(a.mood); bus.send({ type: 'entity.mood', data: { mood: a.mood } }); return { mood: a.mood }; }
          case 'rename': { const n = entity.rename(a.name); bus.send({ type: 'entity.persona', data: entity.personaForShell() }); return { name: n }; }
          default: return { error: 'unknown action' };
        }
      },
    },
    {
      name: 'plan',
      description: 'Split work into parallel waves and pick the cheapest trustworthy model tier per task (haiku/sonnet/opus) using kind priors and the outcome ledger. Then spawn each wave with the Agent tool (model=<tier>). Report outcomes with report=[{kind,model,ok}] so routing improves.',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object', required: ['id', 'title'],
              properties: {
                id: { type: 'string' }, title: { type: 'string' },
                kind: { type: 'string', description: 'format|summarize|classify|extract|lookup|code-edit|research|docs|test-write|ui-build|review-light|architecture|security|debug-hard|refactor-large|design|review-deep|protocol-design|...' },
                complexity: { type: 'integer', minimum: 1, maximum: 5 }, risk: { type: 'integer', minimum: 1, maximum: 5 },
                size: { type: 'string', enum: ['s', 'm', 'l', 'xl'] }, depends: { type: 'array', items: { type: 'string' } },
                needsJudgment: { type: 'boolean' }, userFacing: { type: 'boolean' }, minModel: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] }, estTokens: { type: 'integer' },
              },
            },
          },
          report: { type: 'array', items: { type: 'object', required: ['kind', 'model', 'ok'], properties: { kind: { type: 'string' }, model: { type: 'string' }, ok: { type: 'boolean' }, tokens: { type: 'integer' } } } },
        },
      },
      async handler({ tasks = [], report = [] }) {
        const reported = report.map((r) => router.report(r));
        const plan = tasks.length ? router.plan(tasks) : null;
        return { plan, reported, ledgerEntries: Object.keys(router.ledger.entries).length };
      },
    },
  ];
  return tools;
}

function openSystem(url, log) {
  try {
    const p = process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
    p.unref();
  } catch (err) { log('open', String(err)); }
}
