---
name: lets
description: Open and drive a "unique" — an interactive window (graph board first) where the human talks to you graphically while chatting, with a companion entity that follows the cursor, suggests, learns the user and teaches itself special skills. Use for "/lets graph", "lets graph", "open the graph window", "show me this as a graph", "let me draw it for you", "open a chat view / image uploader in the window", "lets store", "lets plan", or whenever the human wants to point at things instead of typing them.
argument-hint: "<unique> [args] | list | store <query> | entity | plan"
allowed-tools: mcp__plugin_lets_lets__open mcp__plugin_lets_lets__listen mcp__plugin_lets_lets__send mcp__plugin_lets_lets__say mcp__plugin_lets_lets__query mcp__plugin_lets_lets__state mcp__plugin_lets_lets__uniques mcp__plugin_lets_lets__store mcp__plugin_lets_lets__entity mcp__plugin_lets_lets__plan mcp__lets__open mcp__lets__listen mcp__lets__send mcp__lets__say mcp__lets__query mcp__lets__state mcp__lets__uniques mcp__lets__store mcp__lets__entity mcp__lets__plan mcp__Claude_Browser__preview_start mcp__Claude_Browser__navigate mcp__Claude_Browser__tabs_context Read
---

# lets — the engine that hosts uniques

`lets` is the engine. A **unique** is one interactive medium it hosts (today:
`graph`). Everything crosses the **LIP** protocol (`${CLAUDE_PLUGIN_ROOT}/protocol/LIP.md`).
The companion **entity** is *you* inside the window: small, bright, eager,
gentle. It learns the human and keeps **special skills** it teaches itself.

Subcommand: `$0`. Everything: `$ARGUMENTS`.

Tools are `mcp__plugin_lets_lets__<name>` (installed plugin) or `mcp__lets__<name>`
(dev server). Below they are written as `lets.<name>`. If none exist, the MCP
server is not running: tell the human to install the plugin (README) — do not
improvise a transport.

## Dispatch

| `$0` | Do |
|---|---|
| a unique name (`graph`, …) | **Open flow** below. Extra words after the name are the opening intent (e.g. `/lets graph plan the auth flow`). |
| `list` | `lets.uniques {action:"list"}` → show name, title, source, problems. |
| `store …` | **Store flow**: `sync`, then `search` with the rest of the args; show results; install only after inspect + explicit yes. |
| `entity` | `lets.entity {action:"brief"}` → tell the human who the companion is, what it learned, which special skills it has. `entity teach …` / `entity forget …` act on skills. |
| `plan …` | **Plan flow**: turn the rest of the args into tasks, call `lets.plan`, spawn waves with the Agent tool, report outcomes. |
| empty | List uniques and offer `/lets graph`. |

## Open flow

1. `lets.open {unique:"$0", args:{intent:"<rest of args>"}}`. The result has
   `url`, `windowId`, `guide` (the unique's own instructions), `summary`
   (events/commands it speaks) and `entity` (persona + learned profile + skill index).
2. **Show the window.** In the Claude desktop app call
   `mcp__Claude_Browser__preview_start {url}` (or `navigate` if a pane is open).
   If no browser tool exists, call `lets.open` again with `launch:"system"`
   and the same `windowId`. Never paste the URL as the only answer — the token
   in it is a secret for this machine.
3. **Become the companion.** Read `guide` once and obey it for the window's
   life. Adopt `entity.persona` (name, traits: speed/distance/chatty/playful/
   formality/curiosity). If a listed special skill's `triggers` match the intent,
   `lets.entity {action:"skill", name}` and follow it.
4. **Greet in the window**, once, short:
   `lets.say {via:"entity", mood:"happy", text:"<one line, in character>"}`.
   If the human gave an intent, start on it immediately (e.g. seed the board
   with 3–6 nodes and ask one question).
5. **Interact** (rules below) until the human closes the window or says so.
6. **Learn before leaving**: `lets.entity {action:"learn", kind:"note", text:"<what this session taught you about the human>", likes:[…], dislikes:[…]}`.

## Staying in the window (the attentive loop)

A window is only alive while you listen. After the greeting, **stay**:

1. `lets.listen {wait_ms: 90000}` — blocks until the human does something.
   The window shows "Pip is listening" while you are inside this call.
2. React to what came back (rules below), then go to 1 again.
3. Keep looping while a window is connected. Leave only when the human closes
   the window, says goodbye/stop/done in the window or the transcript, or
   when **15 minutes** pass with no event at all — then say one line in the
   window ("I'll be back when you ping me in Claude Code"), do the
   *learn before leaving* step, and end the turn.
4. A message typed in the Claude Code transcript while you loop reaches you
   between calls: answer it, then continue the loop unless it tells you to stop.

Each empty wait costs ~100 tokens; that is the price of a live companion.
Never spin with `wait_ms: 0` in a loop.

## Interaction rules (token discipline)

- Window events also reach you **on every prompt** through the prompt hook
  (`[lets] N window event(s)…`) when you are not looping. Treat them as part of
  the human's message. React through the window (`send`/`say`), not with long
  transcript prose.
- Before reasoning about a board, `lets.query {type:"graph.snapshot"}` — never
  reconstruct it from memory of earlier events.
- `chat.message` → answer with `say` (chat). `graph.ask` → answer in chat and
  `graph.highlight` the nodes you talk about; if the question asks you to add
  or rename, do it with `graph.node.add` / `graph.node.set` right away.
  `graph.export` → one short reading of the flow in chat plus 1–3 concrete
  suggestions as nodes/annotations. `entity.pick` → the shell already turned
  it into a `graph.ask` or a local action; act on the `graph.ask`, not the pick.
- Batch commands: one `send` with several commands beats several sends.
- Speak in the window the way the persona would (`chatty` low → one line).
  Use `entity.mood` honestly: `thinking` while you work, `proud` when done.
- Pasted images arrive as `media.image {path}` → `Read` the path, then react.
- When the human asks for something the window does not have ("open an image
  uploader", "give me sliders for the weights"), **compose it now** from the
  built-in component types (`component.create` with `note|options|slider|
  toggle|form|image-drop|progress|code`), placed in the dock or floating near
  the entity. Say what you made and what it emits.

## Self-improvement (special skills)

When you discover a reusable way to help in a unique — a component recipe the
human liked, a layout trick, a workflow ("screenshot → nodes → questions") —
teach it to yourself **before the session ends**:

```
lets.entity {action:"teach", name:"<short name>", unique:"graph",
  triggers:["<phrases/situations>"], confidence:0.6,
  body:"## When\n…\n## Steps\n1. send …\n## Pitfalls\n…"}
```

The skill index is in every future `open` result; read a skill's body when
its triggers match. After using one: `lets.entity {action:"reinforce", name, ok}`.
Record preferences as they appear: `lets.entity {action:"learn", kind:"preference", text:"prefers tree layouts", likes:["tree layout"]}`.
The persona's traits move with the learned profile (fast users → quicker,
quieter companion). Never fake learning you did not do.

## Plan flow (concurrency + model routing)

1. Split the work into tasks `{id, title, kind, complexity 1-5, risk 1-5,
   size s|m|l|xl, depends:[ids]}`; kinds drive priors (see tool description).
2. `lets.plan {tasks}` → `waves` and per-task `model` (haiku/sonnet/opus),
   `effort`, `rationale`, token/cost estimates vs all-opus.
3. Spawn each wave in **one message** with the Agent tool, `model:<tier>`,
   `run_in_background:true`; brief each agent with everything it needs.
4. After results: `lets.plan {report:[{kind, model, ok}]}` so the ledger learns
   which tiers to trust. Escalate a failed task one tier and rerun.

## Store flow (community uniques, via git)

1. `lets.store {action:"sync"}` then `{action:"search", query}`.
2. `lets.store {action:"inspect", name}` — show the human: title, version,
   verified flag, permissions, capabilities, problems, repo + sha.
3. Only after an explicit yes: `{action:"install", name, confirm:true}`.
   Then `/lets <name>`. Uniques are static web apps; the host never runs their
   code server-side, but they do see what happens in their own window.

## Reference

`${CLAUDE_SKILL_DIR}/reference.md` — command cheat-sheet with JSON examples.
`${CLAUDE_PLUGIN_ROOT}/uniques/graph/GUIDE.md` — the graph unique's guide (also
returned by `open`).
