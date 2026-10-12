# Security policy

`lets` runs a small local web server and loads other people's web pages (uniques) into a browser pane next to Claude. That deserves a clear policy.

## Supported versions

`lets` is pre-1.0. Only the **latest 0.x release** gets security fixes. Update with:

```bash
claude plugin update lets@lets
```

| Version | Supported |
|---|---|
| latest 0.x (0.4.x today) | yes |
| anything older | no, please update |

## How to report a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting: open the **Security** tab of this repository, choose **Report a vulnerability** (https://github.com/TikoTikTok/lets/security/advisories/new), and describe what you found. That creates a private security advisory visible only to you and the maintainer.

Include, as far as you can:

- what is affected (engine, SDK/shell, protocol, installer, hooks, store install path, a specific unique);
- the version (`claude plugin list`) and OS;
- steps or a small proof of concept;
- what an attacker gains.

We will acknowledge the report, keep you updated in the advisory, fix it, and publish the advisory with credit if you want it. If private reporting is not available to you for some reason, open a public issue that says only "I have a security report, how can I send it privately?" and put no details in it.

## The threat model, in short

The full protocol is in [protocol/LIP.md](protocol/LIP.md) (section 4, Transport). The store's side is in the [lets-store README](https://github.com/TikoTikTok/lets-store#security-model-summary). The parts that matter for security:

- **Loopback only.** The host listens on `127.0.0.1` on a free port. It is not reachable from the network.
- **A per-host random token on every request.** It is accepted as the `t` query parameter, the `x-lets-token` header, or the window URL's fragment at open. It lives in `~/.lets/run/host-<pid>.json` (which the prompt hook reads) and in the window URL. Treat a window URL as a secret: do not paste or screenshot it.
- **CSP on served pages: `default-src 'self'`** (scripts are `script-src 'self'`). No CDN, no inline scripts, no `eval`, so a unique cannot load code from elsewhere or send data to another origin from the page.
- **Uploads are capped and confined.** Default cap 25 MB, written only under `~/.lets/uploads/<unique>/`. Claude receives a file path, never base64.
- **Uniques are static and never executed server-side.** The host serves files and routes JSON envelopes. Manifests are schema-validated before a unique is served; the entry file must resolve inside the unique's folder; reserved domains (`lip`, `session`, `entity`, `chat`, `component`, `media`, `ui`) cannot be claimed; every event and command a unique declares must start with a domain it owns. Permissions (`fs.write`, `net`) are declared in the manifest and shown to the human.
- **Store installs are validated and pinned.** Installing from a store means: clone to staging, validate the manifest, check the hash when one is pinned, scan for executables, and only then copy into `~/.lets/uniques`, and only after the human confirms. Entries can pin a commit (`sha`) and the manifest hash (`manifestSha256`). `verified` means a maintainer reviewed the manifest; it is a review mark, not a cryptographic guarantee.
- **Default uniques** (`defaults.json`) are trusted by that list, and are still validated like any other. `LETS_NO_DEFAULTS=1` turns the automatic install off.

What this model does **not** protect against: malware or another user already running as you (anything that can read your home folder can read the token and the files under `~/.lets`, which are plain, unencrypted files, saved sessions included), and vulnerabilities in Claude Code, Node.js or git themselves (report those upstream).

## Uniques reach Claude: treat them like extensions you trust

A unique's events arrive in Claude's context as text: through the `listen` tool, through the prompt hook, and (when loaded as a channel) as channel messages. A unique also ships a `GUIDE.md` that the `/lets` skill tells Claude to follow while its window is open. Labels, node text and session summaries a unique produces can end up in what Claude reads.

So a unique can try to steer Claude, and the protocol cannot fully prevent that, because showing Claude what the human did in the window is the whole point. Install uniques the way you would install an editor extension: from authors you trust, after reading the `store inspect` output (title, version, verified flag, permissions, repo and commit). Prefer entries pinned to a `sha`. Remove one by deleting `~/.lets/uniques/<name>`.

## What counts as a vulnerability

We want to hear about:

- **Token leaks**: the token written to a log, an upload, an event, a response body, a page a unique can read, or any place outside `~/.lets/run` and the window URL.
- **Path traversal**: serving a file outside a unique's folder, the SDK or the uploads folder; an upload or a store install writing outside its directory; a symlink or archive trick with the same effect.
- **CSP bypass**: any way for a unique or an uploaded file to run inline or remote script, load a remote resource, or send data off the machine from the page.
- **A store install (or default install) that executes code**: during clone, validate or copy (git hooks, submodules, filters, symlinks, install scripts), or that skips the validation or the human's confirmation.
- **Escaping a unique's boundaries**: forging `session.*`, `entity.*` or other host- or shell-owned messages, bypassing manifest validation, or using a permission the manifest did not declare.
- **Prompt-injection paths from a unique into Claude** that go beyond what a unique may already do: for example, making Claude act with more authority than the human gave it, hiding text from the human that still reaches Claude, or smuggling instructions through a field the engine presents as trusted (a session label, the guide, the brief).
- **The host listening beyond loopback**, or answering a request without the token.
- **The installer or hooks doing more than INSTALL.md says they do.**

Not a vulnerability: a unique writing misleading text into the events it is allowed to send (that is the medium working as designed, and the reason for the section above); a bug in someone else's unique that stays inside its own window (report it in that unique's repository); problems that need a local attacker who is already you.

A **malicious store entry** is worth a private report too: say which entry and why.
