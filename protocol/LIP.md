# LIP — Lets Interaction Protocol (v1)

LIP is the contract between three parties:

| Party | Role |
|---|---|
| **Claude** (the model, through the `lets` MCP tools) | reasons, reacts, drives |
| **Host** (the `lets` engine, a local Node process) | routes, persists, protects |
| **Window** (a *unique*: a web UI opened in a browser pane) | shows, listens, lets the human point |

A Window may also be a **pane inside Claude Code** (a *native* window, since
0.7.0): the same unique, drawn by the lets-native mod from a tree its native
view produces. It has a window id and speaks the same envelopes (see
[docs/NATIVE.md](../docs/NATIVE.md)).

Everything that crosses a boundary is a **message envelope** (JSON). Uniques are
static web apps that only ever speak LIP; the host never executes the code of a
web unique server-side. That is what makes third-party uniques safe to install
from git. The one opt-in exception is a native view, a script the host runs in a
`node:vm` context (docs/NATIVE.md §8), which is for authors you trust.

The protocol is designed for mediums that do not exist yet: a unique can be a
graph board today, a 3D scene, a voice ring, a haptic strip or an AR overlay
tomorrow. Nothing in LIP assumes a screen — only *events the human produced*
and *commands the model issues*, both carried as typed, versioned JSON.

---

## 1. Envelope

```json
{
  "lip": 1,
  "id": "ev_01J9Q0Z8M3K7X4N2",
  "ts": 1760000000000,
  "dir": "up",
  "from": "unique:graph#w1",
  "type": "graph.node.select",
  "data": { "ids": ["n3"] },
  "re": "cm_01J9Q0Z7...",
  "ttl": 30000
}
```

| Field | Req | Meaning |
|---|---|---|
| `lip` | yes | protocol major version. A receiver that does not speak the major MUST answer `lip.error{code:"unsupported"}`. |
| `id` | yes | unique id (`ev_` for events, `cm_` for commands, `ak_` acks). Time-sortable. |
| `ts` | yes | unix ms at the sender. |
| `dir` | yes | `"up"` = window → host → Claude (an **event**). `"down"` = Claude → host → window (a **command**). |
| `from` | yes | `unique:<name>#<windowId>`, `claude`, `host`, or `hook`. |
| `type` | yes | dotted `<domain>.<noun>[.<verb>]`, lowercase, `a-z0-9_`. |
| `data` | no | the payload, any JSON. Keep it small; put blobs on disk and send paths. |
| `re` | no | id of the message this one answers (ack, reply, stream chunk). |
| `ttl` | no | ms the message stays meaningful. The host drops expired commands instead of delivering them late. |
| `to` | no | (down only) `windowId` or `unique:<name>`; default = every window of the unique the command belongs to. |
| `seq` | no | (down, streams) chunk index; `done:true` closes the stream. |

Batches: a JSON array of envelopes is accepted anywhere a single envelope is.

## 2. Domains

| Domain | Owner | Purpose |
|---|---|---|
| `lip.*` | protocol | hello / ready / ack / error / ping |
| `session.*` | host + shell | window lifecycle (`opened`, `closed`, `focus`, `blur`, `listening`) and handoff (`close`, `closing`, `stay`) |
| `entity.*` | shell | the companion ("you"): summon, dismiss, click, say, mood, suggest, move, profile |
| `chat.*` | shell | chat view: open, close, message, say (stream) |
| `component.*` | shell | dynamic components: create, update, remove, action |
| `media.*` | shell | images / files produced by the human (paste, drop, upload) |
| `ui.*` | shell | toast, theme, layout hints |
| `<unique>.*` | the unique | e.g. `graph.*`. Declared in the unique's manifest. |

Reserved domains cannot be redeclared by a unique. A unique MAY emit shell-domain
events through the shell SDK, never by forging envelopes.

## 3. Core messages

### 3.1 Protocol
| Type | Dir | Data |
|---|---|---|
| `lip.hello` | down | `{windowId, unique, version, caps[], hostVersion}` — first message on an SSE stream |
| `lip.ready` | up | `{unique, version, caps[], viewport:{w,h}, ua}` — the window finished booting |
| `lip.ack` | both | `{ok, error?}`, `re` = acked id. Commands flagged `ack:true` are acked by the window |
| `lip.error` | both | `{code, message, re?}` |
| `lip.ping` / `lip.pong` | both | liveness |

### 3.1b Session (lifecycle and handoff)
| Type | Dir | Data |
|---|---|---|
| `session.opened` / `session.closed` | up (host) | `{windowId, unique, mode?}` — a window connected for the first time / went away for good. `mode` is `"web"` or `"native"` (a pane inside Claude Code); a missing `mode` means `web` |
| `session.focus` / `session.blur` | up | `{}` — the tab became visible / hidden |
| `session.listening` | down (host) | `{on, at}` — whether Claude is blocked in `listen` right now (the shell shows "listening" vs "away") |
| `session.close` | down | `{reason:"handoff"\|"idle"\|"claude", text?, ms?}` — the window should say goodbye and close itself. Sent by the **host** after an *export* event (see §6 `session`), or by Claude. |
| `session.closing` | up (shell) | `{reason}` — the farewell started |
| `session.stay` | up (shell) | `{}` — the human pressed *Keep working*: the window stays |
| `session.consent` | up (host) | `{windowId, unique, runner: true\|false}` — the human allowed (or revoked) the runner for that unique on this machine (docs/RUNNER.md) |

**Handoff.** A unique's manifest names which of its types are the *export*
(the human pressed "Send to Claude"), the *snapshot* (reply to a state query)
and the *restore* command. When an export event reaches the host it is saved
as a **session** (`~/.lets/sessions/<unique>/<id>.json`), its `data` gains
`session: {id, handoff: true, saved: true, summary}` as the first key, and the
window receives `session.close`. Claude then answers in the transcript, not in
the window. `open {resume: "last" | id}` later queues the restore command with
the saved payload, so the window comes back as it was sent; that command's
data carries `session: {id, resumed: true}` first, so a unique can tell a
resume from one of Claude's own loads. Snapshot events
update the saved session silently. `~/.lets/config.json` `"handoff": "stay"`
keeps windows open instead.

### 3.2 Entity (the companion)
Events (up):
- `entity.summon {x,y,context?}` — right click / hotkey; `context` is whatever the unique attaches (e.g. node under cursor).
- `entity.dismiss {}`
- `entity.click {x,y,context?}` — the human clicked the companion. The shell shows local quick-suggestions instantly; Claude may add smarter ones with `entity.suggest`.
- `entity.pick {id, label}` — the human picked a suggestion.
- `entity.profile {pace, clickRate, dwell, regions, idleMs, sessionMs, …}` — aggregated interaction stats, emitted at most every 60 s and on close. Never raw mouse moves.

Commands (down):
- `entity.say {text, mood?, ttl?}` — speech bubble.
- `entity.mood {mood}` — `idle|happy|curious|thinking|busy|proud|sleepy|alert`.
- `entity.suggest {items:[{id,label,hint?}], replace?}` — populate the click menu.
- `entity.move {x,y}` or `{to:"cursor"|"center"|"<selector>"}` — the shell eases there; never teleports.
- `entity.show {}` / `entity.hide {}`
- `entity.persona {name, traits}` — applied look & behaviour (speed, distance) from the persisted persona.
- `entity.react {name, ms?}` — play a short expression (`dizzy`, `whoa`, `startled`, `gasp`, `oops`, `wink`, `cheer`, `blush`, `boop`, `yawn`, `peek`, `nod`, `shake-no`, `wave`, `spin`, `dance`, `disco`, `sparkle`). Most of these the shell also plays by itself from how the human moves; see docs/ENTITY.md.

Event (up): `entity.secret {name}` — the human discovered one of the companion's secret moves (once per window per move).

### 3.3 Chat
- up `chat.message {text, attachments?:[{path,mime}]}`
- down `chat.open {}` / `chat.close {}` / `chat.say {text, seq?, done?}` (stream with same `re`) / `chat.typing {on}`

### 3.4 Components (anything the model invents at runtime)
- down `component.create {id, type, props, slot?:"dock"|"float"|"panel"|"inline", at?:{x,y}}`
- down `component.update {id, props}` / `component.remove {id}`
- up `component.action {id, action, value?}`

Built-in component types every shell MUST provide: `note`, `options`, `slider`,
`toggle`, `form`, `image-drop`, `progress`, `code`. Unknown types fall back to
`note` with the raw props shown, so a future type never breaks an old shell.

### 3.5 Media
- up `media.image {path, w, h, mime, bytes, source:"paste"|"drop"|"file", componentId?}` — the shell POSTs the blob to `/lip/upload`; the host stores it under `~/.lets/uploads/<unique>/` and the event carries the **path**, so Claude reads the file with its own tools. Base64 never crosses to the model.

### 3.6 UI
- down `ui.toast {text, level?:"info"|"ok"|"warn"|"error", ttl?}`
- down `ui.theme {name?, vars?}` — CSS variable overrides.

## 4. Transport

| Leg | Mechanism |
|---|---|
| Window → Host | `POST /lip/event` (envelope or array). Header `x-lets-token`. 202 on accept. |
| Host → Window | `GET /lip/stream?w=<windowId>` — Server-Sent Events, `data:` = envelope JSON. Heartbeat comment every 15 s. |
| Window → Host (blobs) | `POST /lip/upload?w=&source=&component=` raw body, `content-type` = mime. Returns `{path,w?,h?,bytes,mime}`. |
| Window → Host (state) | `GET /lip/persona` and `GET /lip/entity`. Header `x-lets-token`. Read-only host state a unique may fetch: the companion's persona, and the full companion state (persona with likes, dislikes and nicknames, profile, skills, recent memory lines, the secret names). |
| Window → Host (runner info) | `GET /lip/run/info?w=<windowId>`. Header `x-lets-token`. Returns whether the runner is enabled, whether this window's unique is allowed on this machine, the languages the manifest declares in `permissions.exec`, which of them this machine can run and with which sandbox, and the limits. |
| Window → Host (runner consent) | `POST /lip/run/consent?w=<windowId>` body `{"allow": true}`. Records (or, with `false`, revokes) the human's consent for the window's unique on this machine. Returns `{"allowed": true}`. |
| Window → Host (run) | `POST /lip/run?w=<windowId>` body `{lang, code, stdin?, timeoutMs?, run?}`. Streams the run as NDJSON (`application/x-ndjson`): one object per line with `stream` = `system`, `stdout` or `stderr`, then a last line with `done:true, exit, ms, timedOut, killed, sandbox`. Failures before the process starts are plain JSON with a 4xx status (`consent`, `disabled`, `not-declared`, `unavailable`, `busy`, `bad-request`). See [docs/RUNNER.md](../docs/RUNNER.md). |
| Mod ↔ Host (native windows) | The lets-native mod (Claude Code) draws native windows and never runs unique code. All routes need the host token, like every `/lip/*` route. `GET /lip/native/sync?known=<w>:<rev>,…&cols=&rows=` returns `{windows:[{id, unique, title, rev, closed?, tree?}], listening}`, with `tree` only where `rev` moved past `known`. `POST /lip/native/action?w=` with `{key, kind, value?}` is a press, an Enter or a pick; it returns `{ok, rev, tree, error?}`. `POST /lip/native/close?w=` with `{reason}` says the person closed the pane. `POST /lip/native/open` with `{unique, args?, windowId?}` opens a native window and returns `{windowId}`. `GET /lip/native/windows` lists the native windows. See [docs/NATIVE.md](../docs/NATIVE.md) §6. |
| Claude ↔ Host | MCP (stdio). `listen` long-polls the up-queue; `send` enqueues down-commands. |
| Hooks → Host | `GET /lip/drain?cursor=<name>` returns & advances a named cursor — used by the `UserPromptSubmit` hook so events reach Claude without a tool call. |

Security: loopback only; a per-host random token is required on every request
(query `t`, header, or the window's URL fragment at open); CSP on served pages
`default-src 'self'`; uploads are size-capped (default 25 MB) and written only
under the uploads dir; manifests are schema-validated before a unique is served.
The runner (`/lip/run`) only runs after the human allowed that unique on that
machine.

## 5. Queues & cursors

The host keeps one ring buffer of up-events (default 2000). Readers hold
**cursors**: `claude` (the `listen` tool), `hook` (the prompt hook), plus any
named cursor. `listen` returns events after its cursor and advances it; it
blocks up to `wait_ms` when nothing is pending. Noise is coalesced before it
reaches the buffer: pointer moves never enter it, and repeated `graph.changed`
within 400 ms collapse to the latest.

## 6. Unique manifest (`unique.json`)

```json
{
  "lip": 1,
  "name": "graph",
  "version": "0.1.0",
  "title": "Graph — talk in diagrams",
  "description": "Draw flows and ideas; the companion and Claude read them.",
  "entry": "ui/index.html",
  "native": { "entry": "native/index.js" },
  "guide": "GUIDE.md",
  "icon": "icon.svg",
  "domains": ["graph"],
  "capabilities": ["entity", "chat", "components", "media.image", "clipboard"],
  "events": { "graph.node.select": { "summary": "User selected nodes", "schema": "schemas/node.select.json" } },
  "commands": { "graph.node.add": { "summary": "Add a node", "schema": "schemas/node.add.json" } },
  "permissions": { "fs.write": ["uploads"], "net": [], "exec": [] },
  "session": { "export": "graph.export", "snapshot": "graph.snapshot", "restore": "graph.load" },
  "author": { "name": "…", "url": "…" },
  "license": "MIT",
  "repository": "https://github.com/…"
}
```

Rules the host enforces:
1. `name` is `^[a-z][a-z0-9-]{1,31}$`, unique across registries.
2. `entry` resolves inside the unique folder; nothing outside it is ever served.
3. `domains` may not include reserved ones.
4. Every event/command type a unique declares starts with one of its domains.
5. Unknown top-level keys are kept (forward compatibility) but ignored.
6. `lip` major must match the host's.
7. `session` (optional) names the export / snapshot / restore types for handoff (§3.1b); each must start with one of the unique's domains. Without it the host assumes `<domain>.export`, `<domain>.snapshot`, `<domain>.load`.
8. `permissions.exec` (optional) lists the languages the unique may ask the host to run, for example `["python", "javascript"]`. The host refuses `/lip/run` for any other language, and for a unique without `exec`.
9. `native` (optional) declares the native window: `native.entry` resolves inside the unique folder and ends in `.js` or `.mjs`, and at least one of `entry` and `native` must be present (a unique opens in the web, in a pane, or both). `native.title`, `native.columns` and `native.rows` are display hints. The host runs `native.entry` only when the manifest declares it (docs/NATIVE.md).

## 7. Guide (`GUIDE.md`)

Prose for Claude: what each event means and how to react, what commands exist,
and the unique's etiquette. The `open` tool returns it; the `lets` skill tells
Claude to obey it for the window's lifetime. Keep guides under ~1,500 words.

## 8. Versioning

- `lip` major bumps only on envelope-incompatible changes.
- New message types are additive and ignorable: a receiver MUST ignore types it
  does not know (and MAY log them), never fail.
- Uniques pin the minimum host version in `engine: ">=0.1.0"` (optional).

## 9. Future mediums

A unique for a medium without a pointer (voice, gesture, AR, neural) still emits
`entity.summon`, `component.action`, `media.*` — the *meaning* of an act, not its
mechanics. New domains are free to add; shells for new mediums implement §3
semantics in whatever way the medium affords. The envelope never changes shape.
