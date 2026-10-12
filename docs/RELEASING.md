# Releasing

How a `lets` release goes out. Five repos, each with its own version and tag;
the engine's version is the one users see (`claude plugin list`).

## Versions

| Repo | Version lives in | Tag |
|---|---|---|
| `lets` (engine + plugin) | `package.json`, `.claude-plugin/plugin.json`, `CHANGELOG.md` | `vX.Y.Z` |
| `lets-unique-graph` | `package.json`, `unique.json`, `CHANGELOG.md` (all three must agree) | `vX.Y.Z` |
| `lets-unique-template` | `unique.json` | `vX.Y.Z` |
| `lets-store` | `package.json` | `vX.Y.Z` |
| `lets-site` | none (the site tracks the engine) | `site-YYYY-MM-DD` |

Semver, loosely: a new default unique, a protocol change or a user-visible
change to the companion is a minor bump; fixes are a patch. LIP stays additive
inside a major version.

## Checklist

1. **Green.** `npm test` in `lets`, `node scripts/validate.mjs` in
   `lets-unique-graph` and `lets-store`, `claude plugin validate .` in `lets`.
   CI must be green on `main` of every repo you touch.
2. **Versions and changelogs.** Bump the files in the table above. The
   changelog entry names what changed for the human (not the diff), dated.
   History stays history: earlier entries are never rewritten.
3. **Docs follow the UI.** README screenshots match the release (board,
   companion, farewell); `docs/ROADMAP.md` moves shipped issues into a
   "Shipped in X.Y.Z" section; the website (`lets-site`) says the same things
   as the README.
4. **Vendored copies.** `lets-site/sdk/` is a copy of `lets/sdk/`
   (`lets-client.js`, `lets-shell.js`, `lets-shell.css`): re-copy after a shell
   change. `lets-unique-graph/schemas/unique.schema.json` is a copy of
   `lets/protocol/schemas/unique.schema.json`.
5. **Commit and tag** each repo: `git tag -a vX.Y.Z -m "X.Y.Z: <one line>"`,
   then `git push && git push --tags`. The site gets `site-YYYY-MM-DD`.
6. **GitHub release** on `lets` (`gh release create vX.Y.Z --notes-file`
   from the changelog section). The other repos only need the tag.
7. **Install it yourself** from the published marketplace before announcing:
   `claude plugin marketplace update lets`, `claude plugin update lets@lets`,
   restart Claude Code, `/lets graph`, Send to Claude, `/lets graph resume`.
   `node engine/bin/lets.mjs defaults --force --only graph` refreshes the
   installed default unique.
8. **Close the issues** the release shipped, with a one-line comment that
   names the tag.

## When something is wrong after the tag

Fix forward with a patch release. Never move a tag.
