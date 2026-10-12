# lets — tool cheat-sheet

Tool names: `mcp__plugin_lets_lets__<name>` (plugin) / `mcp__lets__<name>` (dev).

## open
```json
{ "unique": "graph", "args": { "intent": "plan the auth flow" } }
{ "unique": "graph", "resume": "last" }                        // bring back the newest board the human sent
{ "unique": "graph", "resume": "s_01K7A2" }                    // a specific saved session (id or prefix)
{ "unique": "graph", "launch": "system", "windowId": "W1" }   // reopen in OS browser
```
Returns `{ url, windowId, guide, summary, entity, sessions:[{id, at, label, summary}], resumed?, handoff }`.

## sessions (what "Send to Claude" saved)
```json
{ "action": "list", "unique": "graph" }
{ "action": "get", "unique": "graph", "id": "last" }          // with the payload
{ "action": "label", "unique": "graph", "id": "s_01K7A2", "label": "bounty harness architecture" }
{ "action": "remove", "unique": "graph", "id": "s_01K7A2" }
```
The export event itself arrives as `graph.export { session: { id, handoff: true, saved: true, summary }, graph }`.

## listen
```json
{ "wait_ms": 0 }                                  // drain
{ "wait_ms": 30000, "types": ["graph.export", "chat.message", "media.*"] }
```
Event shape: `{ id, t, from, ts, data }` (`t` = type, `from` = `graph#W1`).

## send (batch)
```json
{ "commands": [
  { "type": "graph.node.add", "data": { "id": "auth", "label": "Auth service", "kind": "step", "near": "api" } },
  { "type": "graph.edge.add", "data": { "from": "api", "to": "auth", "label": "JWT" } },
  { "type": "graph.highlight", "data": { "ids": ["auth"], "ttl": 4000 } },
  { "type": "entity.say", "data": { "text": "Added **Auth service** next to the API — ok?", "mood": "curious" } },
  { "type": "entity.react", "data": { "name": "wink" } }
]}
```
Expressions for `entity.react`: `cheer wink nod shake-no sparkle dizzy whoa startled gasp oops blush boop yawn peek wave spin dance disco`.
`{ "type": "session.close", "data": { "reason": "claude", "text": "Done here — back in the chat" } }` asks a window to say goodbye and close.

## say
```json
{ "text": "Here is what I see…", "via": "chat", "mood": "thinking" }
{ "text": "chunk…", "stream_id": "s1", "done": false }   // then a final { "done": true }
{ "text": "Nice flow!", "via": "entity", "mood": "happy" }
```

## query (command → reply event)
```json
{ "type": "graph.snapshot" }          // → { reply: { t: "graph.snapshot", data: { graph } } }
```

## components
```json
{ "commands": [
  { "type": "component.create", "data": { "id": "shot", "type": "image-drop", "slot": "float", "props": { "title": "Paste a screenshot", "hint": "Ctrl+V or drop" } } },
  { "type": "component.create", "data": { "id": "w", "type": "slider", "props": { "title": "Weight", "min": 0, "max": 10, "step": 1, "value": 5 } } },
  { "type": "component.create", "data": { "id": "pick", "type": "options", "props": { "title": "Which layout?", "items": [ { "id": "tree", "label": "Tree" }, { "id": "radial", "label": "Radial" } ] } } }
]}
```
Human acts → `component.action { id, action: "pick"|"change"|"submit"|"added"|"close", value }`.

## entity
```json
{ "action": "brief" }
{ "action": "learn", "kind": "preference", "text": "likes short labels", "likes": ["short labels"], "traits": { "chatty": 0.3 } }
{ "action": "teach", "name": "screenshot to nodes", "unique": "graph", "triggers": ["screenshot", "paste image", "turn this into nodes"],
  "body": "## When\nThe human pastes a UI screenshot.\n## Steps\n1. Read the image path.\n2. graph.node.add one node per visible screen/state, kind=step.\n3. graph.edge.add the obvious transitions.\n4. entity.say one question about the unclear ones.\n## Pitfalls\nDo not auto-layout the user's existing nodes." }
{ "action": "skill", "name": "screenshot-to-nodes" }
{ "action": "reinforce", "name": "screenshot-to-nodes", "ok": true }
{ "action": "mood", "mood": "proud" }
{ "action": "full" }                                            // everything he knows: persona, profile, skills, last 60 memory lines, secrets (same as GET /lip/entity)
{ "action": "set", "name": "Spark", "traits": { "chatty": 0.2 }, "color": "#6bf0ff" }   // direct assignment, traits clamped to 0..1
{ "action": "unlearn", "likes": ["auto-layout"], "nicknames": ["the bounty board"], "memory": [1791573980436] }   // memory lines by ts
{ "action": "memory", "n": 30 }                                 // recent lines, each with its ts
{ "action": "reset" }                                           // name, tagline, colour, traits back to defaults; memory and skills stay
```
`full`, `set`, `unlearn`, `memory` and `reset` are what **den** (Doto's home) needs: `den.*` events are applied with them, then `den.refresh`.

## plan
```json
{ "tasks": [
  { "id": "spec", "title": "Write the protocol spec", "kind": "protocol-design", "size": "l" },
  { "id": "ui", "title": "Build the board UI", "kind": "ui-build", "size": "xl", "depends": ["spec"] },
  { "id": "docs", "title": "README", "kind": "docs", "size": "m", "depends": ["spec"] },
  { "id": "fmt", "title": "Format JSON fixtures", "kind": "format", "size": "s" }
]}
{ "report": [ { "kind": "ui-build", "model": "sonnet", "ok": true } ] }
```

## store
```json
{ "action": "sync" }
{ "action": "search", "query": "timeline" }
{ "action": "inspect", "name": "timeline" }
{ "action": "install", "name": "timeline", "confirm": true }
{ "action": "inspect", "name": "https://github.com/someone/lets-unique-foo.git", "path": "", "ref": "main" }
{ "action": "add_store", "name": "my-store", "repo": "https://github.com/me/my-lets-store.git" }
```

## uniques
```json
{ "action": "list" }
{ "action": "info", "name": "graph" }
{ "action": "defaults" }             // install missing default uniques (graph, den) from git
{ "action": "defaults", "name": "graph", "force": true }
```
