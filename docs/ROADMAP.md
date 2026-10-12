# Roadmap

Where `lets` is going next, as GitHub issues. Priorities: **P1** must land
before the repos go public, **P2** soon after, **P3** when someone wants it.
Issues carry the `publish-readiness` label; the umbrella checklist is in the
lets repo.

## Shipped in 0.4.0 (2026-10-12)

- Send to Claude is a handoff: the board is saved as a session, the window
  closes, Claude answers in the chat; `/lets graph resume` brings it back.
- Pip has expressions and secret moves (shell), `entity.react`, `session.close`.
- Hardening from the publish-readiness scan: valid manifest schema + a test
  that every schema parses; the validator reports instead of crashing;
  `store remove` validates names (path traversal); `copyDir` skips symlinks
  and nested `.git`; events must name their window; CSP gains `base-uri`,
  `form-action`, `object-src`; the token is redacted from host logs and from
  `lets doctor`; `npm test` works on Windows.
- INSTALL.md for agents, the copy-paste install prompt, CODE_OF_CONDUCT,
  SECURITY, issue forms, PR template, docs/COMMUNITY.md, the website.

## Open

### lets

| P | Issue | Labels |
|---|---|---|
| P1 | [Verify the handoff end-to-end in the desktop app browser pane](https://github.com/TikoTikTok/lets/issues/1) | sessions, tests |
| P1 | [Public launch checklist (umbrella)](https://github.com/TikoTikTok/lets/issues/2) | publish-readiness, docs |
| P2 | [Require the token for /uploads/ and randomize upload filenames](https://github.com/TikoTikTok/lets/issues/3) | security |
| P2 | [Keep the token out of query strings and logs](https://github.com/TikoTikTok/lets/issues/4) | security |
| P2 | [Pin default uniques by sha in defaults.json and verify on install](https://github.com/TikoTikTok/lets/issues/5) | security, sessions |
| P2 | [Gate store add_store behind confirm:true like install](https://github.com/TikoTikTok/lets/issues/6) | security |
| P2 | [Tests for the security invariants](https://github.com/TikoTikTok/lets/issues/7) | tests, security |
| P2 | [Public install path: zero-credential install on Windows, macOS and Linux](https://github.com/TikoTikTok/lets/issues/8) | docs, publish-readiness |
| P2 | [Re-capture screenshots against the 0.4.0 UI (board, Pip expressions, farewell)](https://github.com/TikoTikTok/lets/issues/9) | docs, companion |
| P2 | [CI: add macOS to the matrix and run claude plugin validate](https://github.com/TikoTikTok/lets/issues/10) | tests, publish-readiness |
| P2 | [Tag releases (v0.4.0) in every repo and write the release checklist](https://github.com/TikoTikTok/lets/issues/11) | publish-readiness |
| P2 | [Resume into the current window (merge) and draw proposals in on resume](https://github.com/TikoTikTok/lets/issues/12) | sessions |
| P3 | [Cap host.uploads / host.opened history and add an uploads quota](https://github.com/TikoTikTok/lets/issues/13) | — |
| P3 | [CI: assert lets-unique-graph/schemas/unique.schema.json matches protocol/schemas](https://github.com/TikoTikTok/lets/issues/14) | — |

### lets-store

| P | Issue | Labels |
|---|---|---|
| P1 | [Pin index entries with sha + manifestSha256 and document the update policy](https://github.com/TikoTikTok/lets-store/issues/1) | security |
| P2 | [Validator: enforce the engine patterns and a real ISO date](https://github.com/TikoTikTok/lets-store/issues/2) | tests |
| P3 | [package.json metadata: license, author, repository, homepage](https://github.com/TikoTikTok/lets-store/issues/3) | docs |

### lets-unique-graph

| P | Issue | Labels |
|---|---|---|
| P2 | [Version-sync guard: package.json, unique.json and CHANGELOG must agree](https://github.com/TikoTikTok/lets-unique-graph/issues/1) | tests |
| P2 | [More board-driven expressions (sparkle on a quick 5-node chain, gasp on node removal)](https://github.com/TikoTikTok/lets-unique-graph/issues/2) | companion |
| P2 | [Re-capture the README screenshot with the 0.3.0 board and Pip](https://github.com/TikoTikTok/lets-unique-graph/issues/3) | docs |

### lets-unique-template

| P | Issue | Labels |
|---|---|---|
| P2 | [Make the pulse dial keyboard-accessible and ARIA-correct](https://github.com/TikoTikTok/lets-unique-template/issues/1) | a11y |
| P2 | [Implement the session block (pulse.export / pulse.load) as the reference for handoff and resume](https://github.com/TikoTikTok/lets-unique-template/issues/2) | sessions |
| P3 | [Add scripts/validate.mjs, a CI workflow and package.json like the other repos](https://github.com/TikoTikTok/lets-unique-template/issues/3) | tests |

## Accepted limits (for now)

- One origin and one token per host, shared by every unique and window. Uniques
  are trusted like editor extensions (SECURITY.md).
- The SSE stream carries the token in its URL (EventSource cannot set headers);
  the host redacts it from logs.
- `/uploads/` is served without the token until the uploads issue lands.
- Defaults and store entries track `main` until pinning lands (two issues above).
