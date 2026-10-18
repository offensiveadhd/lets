# Roadmap

Where `lets` is going next, as GitHub issues. Priorities: **P1** must land
before the repos go public, **P2** soon after, **P3** when someone wants it.
Issues carry the `publish-readiness` label; the umbrella checklist is in the
lets repo.

## In the store (2026-10-13)

- **cocode** 0.1.0, talk in code
  ([lets-unique-cocode](https://github.com/offensiveadhd/lets-unique-cocode),
  `/lets store cocode`): an editor for any language, even one that does not
  exist. Claude predicts the next lines as a ghost the human accepts with Tab,
  prepares the real program in a Build pane so Run is instant, streams the
  output, answers `??` lines inline, and reads *Send to Claude* as a question,
  a task, a bug, a review or a note. Needs no engine change (lets >= 0.4.0);
  a candidate for `defaults.json` once it has been used for a while.
- **mors** 0.1.0, talk in Morse
  ([lets-unique-mors](https://github.com/offensiveadhd/lets-unique-mors),
  `/lets store mors`): one key, one tape. The human keys dots and dashes;
  Send to Claude hands the message over as a prompt and Claude says what it
  read, then does what it says. The window assumes the human knows Morse:
  only Doto helps craft the message (read-back, a spelled ghost, a check,
  the chart, a full controller), and Claude can answer in Morse on a second
  track of the tape. Needs no engine change (lets >= 0.4.0).

## Shipped in 0.7.0 (2026-10-13)

- **Native windows: a unique as a pane inside Claude Code.** `/lets graph
  native` opens the board in Claude Code's own sidebar instead of a browser
  window; `/lets <unique> web` and `native` pick the mode, and a unique
  implements one mode or both (`native.entry` in the manifest). The pane is
  drawn by the optional **lets-native** mod 0.2.0 (`/plugin install
  lets-native@lets`, Claude Code 2.1.287+). graph 0.4.0 is the first unique with
  a native view; den and cocode stay web-only for now. Spec:
  [NATIVE.md](NATIVE.md).
- Engine: a `node:vm` runtime for native views (`engine/src/native.mjs`), the
  `/lip/native/*` routes the mod uses, `mode` on the `open` tool and on
  `session.opened`/`session.closed`, `modes` in the registry, and `lets native`
  in the CLI. `query` now catches a reply that arrives inside the send, and the
  host avoids the ports that `fetch()` and browsers refuse.

## Shipped in 0.6.0 (2026-10-13)

- **den**, Doto's home, is the second default unique
  ([lets-unique-den](https://github.com/offensiveadhd/lets-unique-den), installed
  into `~/.lets/uniques/den` like graph and listed in `defaults.json`). It shows
  what the companion learned about the human (persona and the six traits as
  sliders, likes and dislikes, nicknames, memory lines, special skills, the
  seven secret moves with the found ones lit, the interaction profile) and lets
  them edit or forget any of it by pointing. Claude applies each edit with the
  `entity` tool and confirms it. **Send to Claude** is a handoff for a memory
  review in the chat; "continue" reopens it live.
- Engine: a token-protected `GET /lip/entity` returns the full companion state;
  the `entity` tool gains `full`, `set`, `unlearn`, `memory` and `reset`;
  `profile.secrets` now records the names of the secret moves found, and the
  memory line for a found secret uses the companion's current name.
- The template unique (`pulse`) is 0.2.0: a keyboard-accessible dial, the
  session block (`pulse.export` / `pulse.load`) as the reference for handoff and
  resume, and the validate scaffolding (`scripts/validate.mjs`, CI,
  `package.json`). Closes lets-unique-template #1, #2 and #3.

## Shipped in 0.5.0 (2026-10-13)

- Pip is now **Doto**, a dot that does: new default persona (name, tagline,
  traits), his voice in the shell lines, the skill, GUIDE, README, INSTALL,
  `docs/ENTITY.md` (character sheet) and the website; an untouched Pip
  persona migrates on start.
- The handoff verified end-to-end in the desktop app browser pane with the
  installed plugin (lets #1).
- Screenshots re-captured against the 0.5.0 UI (lets #9, graph #3).
- Releases tagged in every repo and `docs/RELEASING.md` written (lets #11).

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
| P1 | [Public launch checklist (umbrella)](https://github.com/offensiveadhd/lets/issues/2) | publish-readiness, docs |
| P2 | [Require the token for /uploads/ and randomize upload filenames](https://github.com/offensiveadhd/lets/issues/3) | security |
| P2 | [Keep the token out of query strings and logs](https://github.com/offensiveadhd/lets/issues/4) | security |
| P2 | [Pin default uniques by sha in defaults.json and verify on install](https://github.com/offensiveadhd/lets/issues/5) | security, sessions |
| P2 | [Gate store add_store behind confirm:true like install](https://github.com/offensiveadhd/lets/issues/6) | security |
| P2 | [Tests for the security invariants](https://github.com/offensiveadhd/lets/issues/7) | tests, security |
| P2 | [Public install path: zero-credential install on Windows, macOS and Linux](https://github.com/offensiveadhd/lets/issues/8) | docs, publish-readiness |
| P2 | [CI: add macOS to the matrix and run claude plugin validate](https://github.com/offensiveadhd/lets/issues/10) | tests, publish-readiness |
| P2 | [Resume into the current window (merge) and draw proposals in on resume](https://github.com/offensiveadhd/lets/issues/12) | sessions |
| P2 | Native views in a separate process under Node's permission model (so a native view is no longer code in the host's own process) | security |
| P3 | [Cap host.uploads / host.opened history and add an uploads quota](https://github.com/offensiveadhd/lets/issues/13) | — |
| P3 | [CI: assert lets-unique-graph/schemas/unique.schema.json matches protocol/schemas](https://github.com/offensiveadhd/lets/issues/14) | — |
| P3 | Native views for den and cocode | — |

### lets-store

| P | Issue | Labels |
|---|---|---|
| P1 | [Pin index entries with sha + manifestSha256 and document the update policy](https://github.com/offensiveadhd/lets-store/issues/1) | security |
| P2 | [Validator: enforce the engine patterns and a real ISO date](https://github.com/offensiveadhd/lets-store/issues/2) | tests |
| P3 | [package.json metadata: license, author, repository, homepage](https://github.com/offensiveadhd/lets-store/issues/3) | docs |

### lets-unique-graph

| P | Issue | Labels |
|---|---|---|
| P2 | [Version-sync guard: package.json, unique.json and CHANGELOG must agree](https://github.com/offensiveadhd/lets-unique-graph/issues/1) | tests |
| P2 | [More board-driven expressions (sparkle on a quick 5-node chain, gasp on node removal)](https://github.com/offensiveadhd/lets-unique-graph/issues/2) | companion |

### Proposed uniques

Ideas for new uniques, filed as issues in the lets repo with the
`unique-proposal` label so anyone can pick one up. None is promised or
scheduled; how an idea becomes a store entry, and (if it earns it) a default, is
in [COMMUNITY.md](COMMUNITY.md).

| P | Issue | Labels |
|---|---|---|
| P3 | [waves: a board for `/lets plan`, tasks as cards in wave columns with a model-tier chip; Run hands the plan to Claude](https://github.com/offensiveadhd/lets/issues/15) | unique-proposal |
| P3 | [triage: a card stack for verdicts on findings, swipe yes / no / later](https://github.com/offensiveadhd/lets/issues/16) | unique-proposal |
| P3 | [pins: paste a screenshot, drop numbered pins, one word per pin](https://github.com/offensiveadhd/lets/issues/17) | unique-proposal |

## Accepted limits (for now)

- One origin and one token per host, shared by every unique and window. Uniques
  are trusted like editor extensions (SECURITY.md).
- A native view runs in the host's own process, in a `node:vm` context, which
  is isolation and not a security boundary; native-capable uniques are for
  authors you trust (SECURITY.md). Native windows also do not outlive the host:
  a new Claude Code session drops them (saved sessions stay).
- The SSE stream carries the token in its URL (EventSource cannot set headers);
  the host redacts it from logs.
- `/uploads/` is served without the token until the uploads issue lands.
- Defaults and store entries track `main` until pinning lands (two issues above).
