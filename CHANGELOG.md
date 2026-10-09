# Changelog

## 0.3.0 — 2026-10-10

- **Uniques are separate repositories.** `graph` moved to
  https://github.com/TikoTikTok/lets-unique-graph (history preserved); the
  engine ships no unique.
- **Default uniques.** `defaults.json` lists the mediums every install gets;
  the engine clones missing ones into `~/.lets/uniques` on first start, on
  demand when `open` names one, via `lets defaults`, and from `install.mjs`.
  `LETS_NO_DEFAULTS=1` opts out. `uniques {action:"defaults"}` tool action.
- `LETS_UNIQUES_DIRS` (path-separated) adds folders to the registry for
  developing uniques anywhere.
- Tests run against a bundled fixture unique (`tests/fixtures/uniques/mini`).
- Store index: graph points at its repo; pulse (template) listed.

## 0.2.0 — 2026-10-10

Fixes from the first real session on the graph board.

- **Chat / Send to Claude / Ask now get answers.** Events always reached the
  host, but nothing woke Claude. The `/lets` skill now runs an *attentive
  loop* (`listen {wait_ms: 90000}` repeatedly while a window is connected),
  the window shows whether Pip is **listening** (green dot in the chat header
  and on the sprite) or **away** (your message is delivered with your next
  Claude Code prompt), and the engine exposes `session.listening`.
- **Channel support.** The MCP server declares `claude/channel`; when Claude
  Code loads it as a channel (CLI `--channels` / development channels), window
  events wake Claude directly. Inert otherwise.
- **Pip never blocks a drag.** The sprite is click-through unless you reach
  for it slowly (or its menu is open), and it steps further aside while you
  drag anything on the board.
- **Pip keeps a little more distance** from the pointer (66 × 50 px base).
- **Selection-aware questions.** Pip's click menu now asks about what you
  selected or hovered: explain, what's missing, what comes next, break it into
  steps, critique, better name; on empty space: what do you see, suggest a
  structure, review the flow. Each becomes a `graph.ask` with ids and labels.
- CLI: `lets listen`, `lets send`, `lets events`, `lets url` for driving a host
  by hand; `/lip/listen` and `/lip/command` endpoints.
- Host resolves unique assets against the entry folder, rescans uniques added
  after start, serves uploads at `/uploads/…` so image nodes render.

## 0.1.0 — 2026-10-09

First release: engine, LIP v1, graph unique, companion shell, store, template,
native mod, installer.
