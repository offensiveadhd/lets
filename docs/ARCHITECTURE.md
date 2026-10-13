# Architecture

```
┌──────────────┐   MCP (stdio)   ┌───────────────────────┐   SSE ↓ / POST ↑   ┌──────────────────┐
│ Claude Code  │ ◄─────────────► │  lets engine (Node)   │ ◄────────────────► │ Browser window   │
│  /lets skill │   10 tools      │  host · bus · entity  │   loopback + token │  unique + shell  │
│  prompt hook │ ──GET /drain──► │  router · store       │                    │  companion       │
└──────────────┘                 └───────────────────────┘                    └──────────────────┘
                                          │
                                   ~/.lets/ (state)
```

There is a second surface since 0.7.0. For a unique that has a native view, the
window is a pane inside Claude Code itself: the optional **lets-native** mod
polls the same host (`GET /lip/native/sync`), draws the trees the host's native
runtime produces, and posts what the human pressed (`POST /lip/native/action`).
It is the same bus, the same events and commands and the same sessions; only
the display differs. See [NATIVE.md](NATIVE.md).

## Pieces

**engine/src/mcp.mjs** — JSON-RPC 2.0 over newline-delimited stdio. `initialize`,
`tools/list`, `tools/call`, `ping`. No SDK: the plugin installs with zero
`npm install`.

**engine/src/host.mjs** — `http.Server` bound to 127.0.0.1 on a free port.
Routes: `/u/<unique>/…` (static, CSP), `/sdk/…`, `/uploads/…`, `/lip/stream`
(SSE down), `/lip/event` (POST up), `/lip/upload` (blobs → disk → `media.*`
event with a path), `/lip/drain` (named cursor read for hooks), `/lip/persona`,
`/lip/entity` (the full companion state; read-only, token-protected, what den
renders), and `/lip/native/*` (`sync`, `action`, `close`, `open`, `windows`:
the lets-native mod's transport for native windows).
A run file `~/.lets/run/host-<pid>.json` publishes port + token for the hook.

**engine/src/bus.mjs** — one ring buffer of up-events with named cursors
(`claude`, `hook`, ad-hoc query cursors), long-poll waiters, per-window SSE
client sets with pending queues (commands sent before the window connects are
delivered on attach, unless their `ttl` expired), ack tracking, and coalescing
of chatty types (`graph.changed`, `entity.profile`) that no reader has seen.

**engine/src/registry.mjs** — discovers uniques in `uniques/` (bundled, empty),
`~/.lets/uniques` (defaults + store installs), `LETS_UNIQUES_DIRS` (extra
folders), `<project>/.lets/uniques` (local); validates `unique.json` against
`protocol/schemas/unique.schema.json` plus the safety rules (entry and
`native.entry` inside the folder, no reserved domains, declared domains only).
It reports the `modes` each unique supports (`web`, `native`, or both).

**engine/src/defaults.mjs** — the uniques every installation gets
(`defaults.json`: graph and den today). Missing ones are cloned into `~/.lets/uniques`
in the background when the engine starts, on demand when `open` names one, by
`lets defaults`, and by `install.mjs`. Trusted by the list, still validated.

**engine/src/entity.mjs** — persona + profile + memory + skills on disk.
`brief()` is what Claude sees on every `open` (kept small on purpose).
`absorbProfile()` folds the shell's aggregate stats into the learned profile
and nudges the persona's traits. `teach()` writes a special skill. The `entity`
tool also returns the full state and applies the human's edits from den
(`set`, `unlearn`, `reset`); the engine never applies them on its own.

**engine/src/sessions.mjs** — handoff. When a unique's *export* event arrives
("Send to Claude"), the payload is saved under `~/.lets/sessions/<unique>/`,
the event is marked `data.session = {id, handoff:true}` and the window gets
`session.close`; Claude answers in the transcript. `open {resume}` queues the
unique's *restore* command with the saved payload, so the board comes back.
Which types play which role comes from the manifest's `session` block
(`<domain>.export / .snapshot / .load` by default).

**engine/src/native.mjs** — the native window runtime (0.7.0). For a unique
whose manifest has `native.entry` it loads that one script into a fresh
`node:vm` context with no `require`, `process`, timers, network or file system.
The `lets` API, `console` and `ctx` are built inside the context and talk back
through a queue of strings, so nothing of the host's realm is handed over, and
every call into the view (`init`, `render`, `on`, `action`, `export`,
`destroy`) runs with a 2 s timeout. It validates what comes out: state is
plain JSON, a tree uses the whitelisted elements and props (5000 nodes, depth
24, 96 KB). Around the view it draws the native shell (companion line, chat,
components, toasts, Send to Claude, the farewell card). A native window
attaches to the bus like a browser window (queued commands are delivered on
attach, up-events and `session.*` look the same, with `mode: "native"`), and
carries a revision number that the mod's poll compares with what it already
drew. The host serves it on `/lip/native/*`; the `open` tool creates it with
`mode: "native"`.

**mods/lets-native** — the display for native windows, and the only part of
this repo that runs inside Claude Code's process. It is a Claude Code
function-hooks plugin (2.1.287+, installed with `/plugin install
lets-native@lets`). It never runs unique code: it finds the live hosts, polls
`/lip/native/sync` (about every 1.2 s while a native window is open, every 3 s
otherwise), opens one pane per native window, draws the tree with `ui.render`,
posts presses back as actions and tells the host when the person closes a
pane. A `tool.call` hook on `open` makes the pane appear right away. The mod
also provides the bare `/lets` alias and `/lets-pane`.

**engine/src/router.mjs** — kind priors → complexity/risk → tier; a ledger of
outcomes per `(kind, tier)` bumps tiers with poor trust and allows safe
demotions; `plan()` builds topological waves for parallel Agent spawns.

**engine/src/store.mjs** — git stores (`index.json`) → `inspect` (clone to
staging, validate, hash check, executable scan) → `install` (copy to
`~/.lets/uniques/<name>`, record sha). Only after a human confirms.

**sdk/lets-client.js** — the browser transport. **sdk/lets-shell.js** — the
companion, chat, components, media, toasts.

**hooks/drain.mjs** — `UserPromptSubmit`: pulls the `hook` cursor from every
live host and prints the events as context. Window events therefore reach
Claude with the human's next message at zero tool-call cost.

## Why these choices

- **Browser window first, native pane second.** The Claude Code mod API draws
  a constrained element tree (boxes, text, buttons, inputs, selects, SVG,
  markdown, code). A graph board with a flying companion, clipboard paste and
  drag needs a real DOM, so the browser window came first and stays the full
  experience; the app's built-in browser pane makes it feel native anyway.
  Since 0.7.0 the same unique can also open as a pane inside Claude Code,
  because staying in the sidebar is sometimes worth more than a pointer: no
  second window to switch to, and it works where there is no browser pane.
  Both are views of one window model (same LIP events and commands, same
  sessions, same companion), so a unique implements one mode or both and
  Claude does not care which. The pane gives up the pointer (no sprite
  following the cursor, no drag, no image paste), and it costs something the
  web window does not: a native view is code the host runs, in a vm context
  (see the next point).
- **SSE + POST, not WebSocket.** Zero dependencies, trivially debuggable,
  works through any proxy, and the engine must install from git with no build.
- **Events are semantic.** Pointer moves never cross to the model; the shell
  turns behaviour into aggregates (`entity.profile`). Tokens are spent on
  meaning.
- **Static uniques.** Community mediums are HTML/JS served under CSP from
  loopback with a per-host token. The host runs none of their code, with one
  opt-in exception: a native view (the one script a manifest names as
  `native.entry`) runs in a `node:vm` context inside the host. That is
  isolation against mistakes and not a security boundary, so a native-capable
  unique is for authors you trust (see [SECURITY.md](../SECURITY.md)). The
  manifest declares domains, capabilities and permissions up front, and the
  store pins commits and manifest hashes.
- **The guide is data.** Each unique ships `GUIDE.md`; the engine hands it to
  Claude on `open`. New mediums teach Claude how to behave without changing
  the engine or the skill.
- **The companion is persistent and honest.** Learning is explicit (`learn`,
  `teach`, `reinforce`) and inspectable on disk; nothing is "learned" that the
  model did not write down. den shows all of it to the human, and edits go
  back through Claude.

## Lifecycle of `/lets graph`

1. The skill calls `open` → the engine registers a window id, mints the URL
   (`/u/graph/#w=…&t=…`), returns guide + entity brief.
2. Claude opens the URL in the browser pane. The page loads `lets-client.js`,
   connects SSE, receives `lip.hello` and `entity.persona`, emits `lip.ready`.
3. The human draws. The board emits `graph.*`; the shell emits `entity.*`,
   `chat.*`, `component.*`, `media.*`.
4. On the human's next prompt the hook drains those events into context, or
   Claude calls `listen`/`query` explicitly.
5. Claude reacts with `send`/`say`: nodes appear animated, the companion
   speaks, a component card shows up.
6. **Send to Claude**: the host saves the board as a session and closes the
   window; Claude reviews it in the transcript and labels the session.
   `/lets graph` with "continue …" resumes it (`open {resume}`).
7. Before leaving, Claude writes what it learned (`entity learn/teach`).

## Lifecycle of `/lets graph native`

1. The skill calls `open {mode:"native"}` → the engine loads `native/index.js`
   into a fresh vm context, calls `init`, registers the window id and returns
   guide + entity brief with `mode:"native"` and `native.modSeen`. There is no
   URL.
2. The mod sees the window on its next poll of `/lip/native/sync` (or at once,
   from its `tool.call` hook on `open`), opens a pane and draws the tree. If no
   mod has ever polled this host, `modSeen` is false and Claude says so instead
   of waiting.
3. The human presses and types in the pane. The mod posts each act to
   `/lip/native/action`; the view handles it and emits `graph.*` events, and
   the new tree comes back in the response, so the pane redraws at once. The
   native shell emits `entity.*`, `chat.*` and `component.*` as the browser
   shell does.
4. On the human's next prompt the hook drains those events into context, or
   Claude calls `listen`/`query` explicitly (a `query` answered inside the send
   is caught).
5. Claude reacts with `send`/`say`: the view's handlers run in the host, the
   revision moves, and the pane redraws at the mod's next poll (about a
   second): nodes change, the companion line speaks, a card shows up.
6. **Send to Claude**: the view's `export()` payload goes out as the export
   event, the host saves the board as a session and sends `session.close`, the
   shell shows the farewell card and the pane closes itself; Claude reviews it
   in the transcript. `open {mode:"native", resume:"last"}` brings it back.
7. If the person closes the pane instead, the mod posts
   `/lip/native/close` → `session.closed`, and the host drops the context. A
   new Claude Code session drops native windows too; saved sessions stay.

## Future mediums

A unique may be anything the LIP envelope can carry. A voice ring would emit
`chat.message` from transcription and `entity.summon` on a wake word; an AR
overlay would emit `component.action` from gestures. The shell contract
(entity/chat/components/media) is the stable surface; the engine, the skill
and the store need no change for a new medium.
