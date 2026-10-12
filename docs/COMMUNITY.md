# Community

`lets` is small on purpose: an engine, a protocol, a companion, and mediums (uniques) that anyone can build. This page is the short map of how people take part.

Be kind to each other ([CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)). Report security problems privately ([SECURITY.md](../SECURITY.md)). The ground rules for code are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Where things live

| Repo | What goes there |
|---|---|
| [lets](https://github.com/TikoTikTok/lets) | The engine, the Claude Code plugin and marketplace, the LIP protocol, the SDK and shell (Doto, chat, components), the installer, `defaults.json`. Bugs, feature ideas, protocol changes, default proposals. |
| [lets-unique-graph](https://github.com/TikoTikTok/lets-unique-graph) | The graph board, the first and (today) only default unique. Board bugs and ideas. |
| [lets-unique-template](https://github.com/TikoTikTok/lets-unique-template) | The template repository for a new unique (`pulse`, a dial you talk through). Start here to build one. |
| [lets-store](https://github.com/TikoTikTok/lets-store) | The community store: `index.json` of uniques by git URL, the validator, the contribution checklist. Pull requests for store entries. |
| [lets-site](https://github.com/TikoTikTok/lets-site) | The website, published at https://tikotiktok.github.io/lets-site/. |

## Propose a unique

There are two destinations, and the second is much narrower than the first.

**To make your unique available to anyone who looks for it** (the store):

1. **Start from the template.** Use [lets-unique-template](https://github.com/TikoTikTok/lets-unique-template) ("Use this template"), name your repo `lets-unique-<name>`, and rename `pulse` everywhere (manifest `name`, `domains`, event and command types, `data-unique`, `Lets.connect`). [UNIQUES.md](UNIQUES.md) is the authoring guide.
2. **Build and check it locally.** Run it on the host with `LETS_UNIQUES_DIRS=/path/to/parent node engine/bin/lets.mjs serve --open <name>` and validate with `node engine/bin/lets.mjs validate ./<name>`. Zero console errors is the bar. A unique is static: HTML, ES modules, CSS, no build step, no CDN, nothing executed server-side.
3. **Push it to GitHub** (public, or a URL people can clone).
4. **Open a pull request to [lets-store](https://github.com/TikoTikTok/lets-store)** adding an entry to `index.json`: `name`, `title`, a one-line `description`, `repo`, `ref`, ideally a pinned `sha` and `manifestSha256`, `tags`, `author`. Follow that repo's [CONTRIBUTING.md](https://github.com/TikoTikTok/lets-store/blob/main/CONTRIBUTING.md) checklist and run its validator (`npm run validate`). New entries land unverified.
5. **Verification.** A maintainer re-checks the manifest at the pinned commit and, if everything holds, sets `"verified": true` in a follow-up commit. "Verified" means the manifest validates against the LIP schema, the unique is static-only, every event and command starts with a domain it owns (no reserved ones), and every permission it needs is declared. It is a review mark, not a cryptographic guarantee; pinning `sha` is what freezes the reviewed content. The policy is written down in the [lets-store README](https://github.com/TikoTikTok/lets-store#what-verified-means).

People then install it with `/lets store <name>` (inspect, then confirm).

**To ask for it to become a default** (`defaults.json`, installed for every user):

6. **File the proposal.** Once your store entry is verified, open the [Propose a unique for the defaults](https://github.com/TikoTikTok/lets/issues/new?template=unique-proposal.yml) form. It asks for the name, repo, a one-liner, what the human does with it, the permissions it needs, the store entry, and why it should be a default.
7. **Discussion happens in that issue.** Defaults are installed on everyone's machine, so the bar is higher than for the store. What the maintainers weigh: it is store-verified, it is solid rather than a demo, its permissions are minimal (ideally none), its guide is short and clear, it adds a medium the defaults do not already cover, and someone is willing to maintain it.
8. **If it is accepted,** a maintainer adds it to `defaults.json` in a pull request (the file is the approved list; the engine installs it from git on first use and still validates it).

Today `defaults.json` has one entry, `graph`. Nothing else is promised or pending: `pulse` is in the store as the template, and the store is where candidates grow.

## What is next

[ROADMAP.md](ROADMAP.md) lists what is shipped and what is open, as GitHub issues with P1/P2/P3 priorities and the `publish-readiness` label. Pick one, say so in the issue, go.

## How to help

- **Triage.** Reproduce a bug, ask for the output of `node engine/bin/lets.mjs doctor` (with the token removed), narrow it down, point to the likely file. This is a real contribution.
- **Test on your machine.** CI runs Ubuntu and Windows on Node 20 and 22. macOS is not in CI, so reports from macOS are especially welcome. So are reports from other terminals, shells and Claude Code versions.
- **Docs.** Fix what confused you. The install instructions ([INSTALL.md](../INSTALL.md)) and the authoring guide are the most-read pages.
- **A unique for a new medium.** The protocol assumes mediums that do not exist yet: a timeline, a 3D scene, a voice ring, a haptic strip, an AR overlay. Think in acts, not widgets (`timeline.span.set`, not `mouse.drag`), and see [LIP.md](../protocol/LIP.md) section 9.
- **Teach Doto a trick.** New reactions and expressions live in the shell (`sdk/lets-shell.js`); see [ENTITY.md](ENTITY.md) and [UI-CONTRACT.md](UI-CONTRACT.md). Keep them short, quiet and kind to people who prefer reduced motion.
- **Code.** Small pull requests with a test, please. The PR template has the checklist: zero dependencies, LIP stays additive, tests pass, docs updated, a CHANGELOG line.

## How decisions get made

In the open, in issues. Someone describes the problem first, the discussion happens in the thread, and a maintainer summarises and decides, writing the reasoning down so the next person can find it. Questions that come up again and again:

- *Can this be an additive LIP message instead of a change?* If yes, that is the answer.
- *Does it cost tokens?* Anything that reaches Claude must be compact and semantic; pointer moves and animations stay in the browser.
- *Does it widen the security surface?* Loopback, the token, the CSP, confined uploads and "uniques are never executed" are not up for trade.

Maintainers, for now: **TikoTikTok**.
