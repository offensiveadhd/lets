# Contributing

Thanks for helping. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first, and
report security problems privately as described in [SECURITY.md](SECURITY.md),
not in a public issue. [docs/COMMUNITY.md](docs/COMMUNITY.md) is the map of
which repo does what and how to help.

## Issues and pull requests

Open issues with the forms (blank issues are off):

- **Bug report**: asks for steps, what you expected, your OS and Claude Code
  version, and the output of `node engine/bin/lets.mjs doctor` (remove the
  `token` value before pasting).
- **Feature request**: for the engine, Doto, the SDK, the protocol or the install.
- **Propose a unique for the defaults**: only for a unique that is already
  verified in [lets-store](https://github.com/TikoTikTok/lets-store).

Pull requests get a template with a short checklist: zero dependencies kept,
LIP additive, tests pass, docs updated, a CHANGELOG line.

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

Most new uniques do not belong in this repo. Build one from
[lets-unique-template](https://github.com/TikoTikTok/lets-unique-template), send
a pull request to [lets-store](https://github.com/TikoTikTok/lets-store), and,
once it is verified there, you can propose it for `defaults.json` with the
unique-proposal issue form. The whole path is in
[docs/COMMUNITY.md](docs/COMMUNITY.md).

## Adding a tool

Tools live in `engine/src/tools.mjs`. Keep names short (they are prefixed by
Claude Code), describe them for the model, return compact JSON, and add a
case to `tests/mcp-smoke.mjs`. Update `skills/lets/SKILL.md` `allowed-tools`
and `reference.md`.

## Commit style

Conventional-ish: `engine:`, `sdk:`, `graph:`, `skill:`, `docs:`, `protocol:`.
Add a line to [CHANGELOG.md](CHANGELOG.md) for anything a user or a unique author would notice.
