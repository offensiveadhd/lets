# Install lets (written for an agent)

This file is for the agent (Claude Code) that will install `lets` on the human's machine. If you are the human: you pasted this prompt, and your agent is following the steps below.

```text
Install the `lets` plugin for Claude Code on this machine: clone https://github.com/TikoTikTok/lets (use `gh repo clone TikoTikTok/lets` — it is private, so make sure `gh auth status` is logged in and run `gh auth setup-git`), then run `node install.mjs` inside the clone and follow INSTALL.md in that repo. When done, tell me to restart Claude Code and show me `/lets graph`.
```

`lets` is a Claude Code plugin: an engine (a zero-dependency Node MCP server), a `/lets` skill, and a companion called Doto, a small dot that does. Installing it needs no `npm install`, no build step and no admin rights. Everything it keeps lives under `~/.lets`.

## Ground rules for you, the agent

- Run the commands in this file and nothing else. If a step fails, quote the real output to the human, say which step failed, and stop. Do not improvise a workaround that edits Claude Code settings or hooks.
- Never ask for, type or store credentials. If GitHub is not logged in, ask the human to run `gh auth login` themselves.
- Ask the human a question only when something is ambiguous (for example, the target folder already exists and is not a lets checkout).
- Do not push, commit or open issues. This is a read-and-install job.

## Preconditions

Check each one. Every check is read-only.

| Need | Check | Notes |
|---|---|---|
| Node 18 or newer | `node --version` | The installer and the engine are plain ES modules. |
| Claude Code CLI | `claude --version` | Must be on `PATH`. The installer drives `claude plugin ...`. |
| git | `git --version` | The engine clones default uniques with it. |
| GitHub CLI, logged in | `gh --version` and `gh auth status` | Needed while the repo is private. If `gh auth status` says you are not logged in, stop and ask the human to run `gh auth login` in their own terminal, then continue. |
| git can read the private repo | `gh auth setup-git` | Run it once. It lets plain `git` (and therefore `claude plugin marketplace add TikoTikTok/lets`) use the human's GitHub login. Safe to repeat. |

Optional check that access works before you clone: `git ls-remote https://github.com/TikoTikTok/lets.git HEAD` should print a commit hash, not an authentication error.

## Steps

### 1. Get the repo

If the current directory is already a lets checkout (it contains `install.mjs` and `.claude-plugin/plugin.json`), skip to step 2 and run `git pull` first.

Otherwise clone into `~/proj/lets` (or the folder the human named). If `~/proj/lets` exists and is a lets checkout, run `git pull` inside it instead of cloning. If it exists and is something else, ask the human where to put it.

bash / Git Bash / zsh:

```bash
mkdir -p ~/proj
gh repo clone TikoTikTok/lets ~/proj/lets
cd ~/proj/lets
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\proj" | Out-Null
gh repo clone TikoTikTok/lets "$HOME\proj\lets"
Set-Location "$HOME\proj\lets"
```

### 2. Run the installer

From inside the clone:

```bash
node install.mjs
```

It prints each command it runs. In order, it:

1. checks that the `claude` CLI answers `--version` (on Windows it goes through the `claude.cmd` shim by itself);
2. adds the `lets` marketplace from GitHub (`claude plugin marketplace add TikoTikTok/lets`), or refreshes it if it is already added;
3. installs the plugin at user scope (`claude plugin install lets@lets --scope user`), or updates it if it is already installed;
4. installs the personal `/lets` alias skill into `~/.claude/skills/lets` (`node engine/bin/lets.mjs install-skill`), so the bare `/lets graph` works as well as `/lets:lets graph`;
5. installs the default uniques listed in `defaults.json` into `~/.lets/uniques` (today: `graph`, via `node engine/bin/lets.mjs defaults`);
6. lists the installed plugins (`claude plugin list`) so you can confirm `lets@lets` is there.

It never touches the companion's memory in `~/.lets/entity`, so reinstalling is safe.

Options (use only if the human asked for them or a step below says so):

| Flag | Does |
|---|---|
| `--local` | take the marketplace from this checkout instead of GitHub. Use it when developing, or when the `claude` side cannot authenticate to GitHub. Default uniques are still cloned from GitHub. |
| `--native` | also install the optional `lets-native` mod (`/lets` and a live `/lets-pane`; needs Claude Code 2.1.287+). It provides `/lets` itself, so the alias skill is skipped. |
| `--no-skill` | skip the personal `/lets` alias skill. |
| `--uninstall` | remove everything the installer added (see Uninstall). |

By hand, inside Claude Code, the equivalent of steps 2 and 3 is:

```
/plugin marketplace add TikoTikTok/lets
/plugin install lets@lets
```

followed by `node engine/bin/lets.mjs install-skill` and `node engine/bin/lets.mjs defaults` in the clone.

### 3. Hand back to the human

You cannot restart Claude Code for them. Tell them, in this order:

1. Restart Claude Code (or run `/reload-plugins`) so the plugin, the MCP server and the `/lets` alias are loaded.
2. Then run `/lets graph`. That opens the board and Doto rolls up to greet them.

Mention that the repo is private for now, that their saved boards and Doto's memory live in `~/.lets`, and that `/lets graph resume` brings a saved board back.

## Verify

Run these after the human has restarted (or after `/reload-plugins`).

| Check | Expect |
|---|---|
| `claude plugin list` | an entry for `lets@lets`, enabled |
| `/lets:lets list` | the `graph` unique, with no problems listed |
| `/lets graph` | the board opens in the app's browser pane (or the default browser, see Troubleshooting) and Doto rolls up and says hello |
| `node engine/bin/lets.mjs doctor` (in the clone) | JSON with your `node` version, the lets `root` and `home`, any running `hosts`, and `uniques` containing `"graph:ok"` |
| `node engine/bin/lets.mjs validate` (in the clone) | `ok` for every known unique, exit code 0 |

`hosts` is empty when no window is open; that is normal. When a host is running, `doctor` prints its run file, which includes the host's secret `token`. Do not paste that output into a chat, an issue or a log without replacing the token value first.

## Troubleshooting

**`claude` is not found.** Install Claude Code first (https://code.claude.com), open a new terminal so `PATH` refreshes, and run `claude --version`. On Windows the npm global shim is `claude.cmd` in `%APPDATA%\npm`; make sure that folder is on `PATH`. The installer exits with "claude CLI not found on PATH" in this case and has changed nothing.

**The marketplace cannot be added (private repo, authentication).** Run `gh auth status`, then `gh auth setup-git`, then retry `node install.mjs`. Check access with `git ls-remote https://github.com/TikoTikTok/lets.git HEAD`. If git itself works but `claude` still cannot reach GitHub, run `node install.mjs --local` from the checkout. If the human has no access to the repo at all, say so; do not look for another source.

**Windows notes.** PowerShell and Git Bash both work. The installer runs `claude` through a shell on Windows because it is a `.cmd` shim; you do not need to do anything for that. Quote paths that contain spaces. State is in `%USERPROFILE%\.lets` (`$HOME\.lets`).

**The graph default failed to install.** The installer prints "could not install a default unique now"; the engine retries on first use, but you can do it now. It needs git and access to the repo:

```bash
node engine/bin/lets.mjs defaults            # install what is missing
node engine/bin/lets.mjs defaults --force    # reinstall graph even if present
```

If the human set `LETS_NO_DEFAULTS=1`, defaults are skipped on purpose; unset it first.

**The browser pane does not open.** In the Claude desktop app the board opens in the built-in browser pane. If there is no pane or it refuses, ask `lets` to open the window with `launch: "system"` (the `open` tool option), which opens it in the OS default browser. Do not paste the window URL as the only answer: it carries a token that is a secret for this machine.

**`/lets:lets` works but bare `/lets` does not.** The alias skill is missing. Run `node engine/bin/lets.mjs install-skill`, then restart Claude Code. (With `--native`, `/lets` comes from the `lets-native` mod instead.)

**`/lets` runs but there are no lets tools.** The MCP server is not loaded. Run `/reload-plugins` or restart, then check `claude plugin list`. From the checkout, `claude plugin validate .` checks the manifests.

**Anything else.** Logs are in `~/.lets/logs/`; set `LETS_DEBUG=1` to mirror them on stderr. `node engine/bin/lets.mjs doctor` shows what the engine sees.

## Update

```bash
claude plugin update lets@lets
```

Restart Claude Code afterwards. If you installed from a checkout, `git pull` there and run `node install.mjs` again; it refreshes the marketplace and updates the plugin.

## Uninstall

```bash
node install.mjs --uninstall
```

This removes `lets-native` (if present), the `lets` plugin, the `lets` marketplace and the alias skill in `~/.claude/skills/lets`. It keeps `~/.lets`: the companion's persona, profile, memory and special skills, your saved sessions, and the uniques installed there. Delete `~/.lets` only if the human wants to forget the companion and everything else; ask first, because it cannot be undone.
