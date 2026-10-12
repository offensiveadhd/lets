## What and why

<!-- One or two sentences. What changes for the human, or for someone building a unique? Link the issue: "Closes #123". -->

## How I tested it

<!-- Commands you ran, what you clicked, what you saw. -->

## Checklist

- [ ] **Zero runtime dependencies** are kept in `engine/` and `sdk/` (no npm packages, no CDN, no build step).
- [ ] **LIP stays additive**: any new behaviour is a new message type that old receivers can ignore; the envelope is unchanged.
- [ ] **Tests pass**: `npm test`, `node tests/mcp-smoke.mjs`, `node tests/hook-drain.mjs`, and `node engine/bin/lets.mjs validate`.
- [ ] **Docs are updated** where they apply: `README.md`, `docs/`, `protocol/LIP.md`, `sdk/README.md`, and for tools or commands `skills/lets/SKILL.md` (`allowed-tools`) and `skills/lets/reference.md`.
- [ ] **CHANGELOG line** added for the upcoming version in `CHANGELOG.md`.
- [ ] **Tokens stay the budget**: anything that reaches Claude (events, briefs, guides) is compact and semantic; pointer moves stay in the browser.
- [ ] **Security surface unchanged**: loopback only, per-host token, CSP `default-src 'self'`, capped and confined uploads, uniques never executed server-side. If this PR touches any of them, say how below.

## Notes for the reviewer

<!-- Anything risky, anything you are unsure about, anything you deliberately left out. Commit prefixes are engine:, sdk:, graph:, skill:, docs:, protocol:. -->
