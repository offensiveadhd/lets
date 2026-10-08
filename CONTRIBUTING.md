# Contributing

## Ground rules

- **Zero runtime dependencies** in `engine/` and `sdk/`. The plugin installs
  from git with no build step; keep it that way.
- **LIP is the API.** New behaviour is a new message type (additive, ignorable),
  never a new transport or a change to the envelope. Bump `lip` only for
  envelope-incompatible changes, which should be never.
- **Uniques are static.** Nothing in `uniques/` runs server-side.
- **Tokens are the budget.** Anything that reaches Claude (events, briefs,
  guides) must be compact and semantic. Pointer moves stay in the browser.

## Dev loop

```bash
npm test                         # unit
node tests/mcp-smoke.mjs         # stdio ↔ host ↔ fake window
node engine/bin/lets.mjs serve --open graph --verbose
claude plugin validate .
claude --plugin-dir . # then /lets:lets graph
```

Logs: `~/.lets/logs/`. Set `LETS_DEBUG=1` to mirror them on stderr.

## Adding a unique

Follow [docs/UNIQUES.md](docs/UNIQUES.md). Bundled uniques live in `uniques/`
and must pass `node engine/bin/lets.mjs validate uniques/<name>`.

## Adding a tool

Tools live in `engine/src/tools.mjs`. Keep names short (they are prefixed by
Claude Code), describe them for the model, return compact JSON, and add a
case to `tests/mcp-smoke.mjs`. Update `skills/lets/SKILL.md` `allowed-tools`
and `reference.md`.

## Commit style

Conventional-ish: `engine:`, `sdk:`, `graph:`, `skill:`, `docs:`, `protocol:`.
