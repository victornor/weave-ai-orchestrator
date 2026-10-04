# Weave AI

Weave AI turns a directory into a **workspace**: a virtual business made of one or more git
projects, staffed by AI agents with well-defined roles and coordinated by one **weaver** agent
that you talk to. You say "add dark mode to the dashboard"; the weaver turns that into a ticket,
hires a role for the project if none fits, and a disposable **worker** picks it up in its own git
worktree, proposes a plan, waits for your approval, implements it, opens a PR, and merges it once
you approve. You never manage the mechanics — state transitions, worktrees, locks, git operations,
OpenSpec state, cost accounting are all code; only judgment is left to agents.

The daemon is a **server**. It holds the workspaces, the coding CLIs and their credentials, the git
and forge credentials, and the channel bots. Everything else is a client: the web app (an
installable PWA), the `weave` CLI, Telegram. Nothing on your laptop needs to be running for work to
progress — close it mid-ticket and the workers keep going on the daemon host. Remote access is
password-gated and encrypted by default; the only unauthenticated mode is an explicit loopback-only
setting for local development.

Workers run on whatever coding CLI you chose for that project — Claude Code, OpenCode, Codex,
Gemini CLI — and never cross the project boundary: a worker in project A cannot learn that project B
exists. Change tickets follow OpenSpec's propose → approve → apply → archive flow, so every landed
change leaves a spec behind. Familiarity with a project lives in a budgeted, curated knowledge base
rather than in a long chat, so bootstrap cost per worker stays flat over the life of the workspace.

- [`docs/PLAN.md`](docs/PLAN.md) — the implementation plan: decisions, domain model, interfaces, milestones.
- [`docs/API.md`](docs/API.md) — the HTTP + SSE + MCP control-plane API.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — running a daemon on a server: systemd, TLS, backups, upgrades, troubleshooting.
- [`docs/DOCKER.md`](docs/DOCKER.md) — the container image: one `/data` volume, what it does and does not carry.
- [`docs/SCENARIOS.md`](docs/SCENARIOS.md) — end-to-end walkthroughs of what each participant sees.
- [`docs/demos/`](docs/demos/) — reproducible M1–M6 demo scripts against the real commands.
- [`skills/README.md`](skills/README.md) — the agent-facing instruction layer.
- [`CLAUDE.md`](CLAUDE.md) — conventions for coding agents working on this repo.

---

## Requirements

| | |
|---|---|
| Node | **≥ 22** (the DB uses `node:sqlite`). Repo pins Node 26 via `mise.toml`. |
| pnpm | 11.x (`mise` installs it; `corepack` works too) |
| git | required |
| A coding CLI | at least one of `claude`, `opencode`, `codex`, `gemini`, **logged in on the daemon host** |
| `gh` | required for `deliveryMode: pr` (the default). Use `deliveryMode: local-branch` without it. |
| `openspec` | optional, recommended — `npm i -g @fission-ai/openspec`. Without it `change` tickets skip spec artifacts and the Spec Explorer is empty. |
| `worktrunk` (`wt`) | optional, recommended — `cargo install worktrunk` / `brew install worktrunk` / `pacman -S worktrunk`. Without it the built-in `git worktree` fallback is used automatically. |

Nothing is installed for you by default. `weave doctor` reports what is missing on this machine and on the daemon host; `weave doctor --install` offers to install the missing pieces that need no root (npm packages such as `openspec` and the runtime CLIs, `brew`/`cargo` for worktrunk) and prints the `sudo` command for the rest.

## Install

```bash
git clone git@github.com:victornor/agent-conductor.git && cd agent-conductor
mise install                 # node + pnpm, if you use mise
pnpm install
pnpm build                   # tsc -b across every package
pnpm --filter @weave-ai/ui build    # the web app -> packages/ui/dist
```

Once the daemon runs from a release, `weave daemon install-service` (and every `weave daemon upgrade`)
writes `~/.local/bin/weave` for you, pointing at the current release. Before that first install — a
source checkout — put `weave` on your PATH either by linking the package or with a two-line wrapper
(the wrapper is what survives a `mise` node upgrade and works from systemd):

```bash
cd packages/cli && pnpm link --global          # option 1
# option 2
cat > ~/.local/bin/weave <<EOF
#!/bin/sh
exec "$(mise which node)" "$PWD/packages/cli/dist/bin.js" "\$@"
EOF
chmod +x ~/.local/bin/weave
```

The pre-rename `conductor` command still works as a deprecated alias — an existing
`~/.local/bin/conductor` shim is rewritten to run `weave` and prints a one-line notice; it will be
removed later.

Then let the doctor tell you what else this machine needs:

```bash
weave doctor              # node, git, gh, openspec, worktrunk, runtimes, daemon, password, workspaces
weave doctor --install    # offers the missing no-root installs (npm/brew/cargo); prints the sudo ones
```

`weave doctor` is the checklist for the rest of this README: whenever a step below fails, run it
first. Against a remote daemon it also reports what is missing on the daemon host.

Everything below assumes `weave` is on your PATH. Where it is not, substitute
`node packages/cli/dist/bin.js`.

Root scripts: `pnpm build`, `pnpm test` (vitest), `pnpm lint` (the boundary and console guards),
`pnpm typecheck`, `pnpm dev` (daemon in the foreground).

CI runs the same checks on a **self-hosted GitHub Actions runner** on the maintainer's host, not on
GitHub-hosted minutes — see [`docs/OPERATIONS.md` §9 "Self-hosted CI runner"](docs/OPERATIONS.md#9-self-hosted-ci-runner)
for the setup, status, logs and removal commands.

---

## Quickstart A — one machine, local development

```bash
# 1. Trust loopback so you can skip the password while developing.
mkdir -p ~/.config/weave
cat > ~/.config/weave/daemon.yaml <<'YAML'
version: 1
http:
  listen: 127.0.0.1:7433
auth:
  loopbackTrusted: true
YAML

# 2. Start the daemon and check the machine.
weave daemon start
weave doctor                      # green, or exactly what is missing (and --install for the no-root parts)

# 3. Create a workspace. It is scaffolded on the daemon host and registered.
weave init ~/Work/acme --prefix ACME --name "Acme Labs"

# 4. Make sure a coding CLI is available and authenticated.
weave runtime list
weave runtime login claude        # only if the inherited credentials are not enough

# 5. Add a project. Clones it, runs `openspec init`, seeds the project KB,
#    and creates a scout ticket that describes the repo.
weave project add git@github.com:acme/api.git --runtime claude

# 6. Talk to the weaver.
weave say "what is in this workspace?"
weave chat                        # interactive
```

Open <http://127.0.0.1:7433> for the web app. If it shows "the web UI has not been built", run
`pnpm --filter @weave-ai/ui build` and reload.

**Credentials.** When a workspace loads, the daemon copies the host user's coding-CLI credentials
into a per-workspace config home under `<workspace>/.weave/runtimes/<runtime>/` — it never
reads or writes your personal CLI config afterwards. Copied files:

| Runtime | From | Config-home env |
|---|---|---|
| `claude` | `~/.claude/.credentials.json` | `CLAUDE_CONFIG_DIR` |
| `codex` | `~/.codex/auth.json` | `CODEX_HOME` |
| `gemini` | `~/.gemini/oauth_creds.json`, `google_accounts.json` | `GEMINI_CLI_HOME` |
| `opencode` | `~/.local/share/opencode/auth.json` | `XDG_CONFIG_HOME` |

If a runtime was not logged in on the host when the workspace first loaded, run
`weave runtime login <id>` — it runs that CLI's own login flow with the env pointed at the workspace
config home.

## Quickstart B — daemon on a server, work from a laptop and a phone

The daemon host is where code runs, where the coding CLIs live, and where git credentials live.
The easiest safe network is a tailnet: bind to the machine's Tailscale address and every device
you own can reach it, nothing else can.

On the **server**:

```bash
# Install as above, then configure the listener (Tailscale example; use 0.0.0.0 for a LAN/VPS).
mkdir -p ~/.config/weave
cat > ~/.config/weave/daemon.yaml <<'YAML'
version: 1
http:
  listen: 100.x.y.z:7433                          # `tailscale ip -4`
  publicUrl: https://myhost.tailnet-name.ts.net:7433   # `tailscale status` shows the MagicDNS name
  tls:
    mode: tailscale            # a browser-trusted Tailscale certificate; see docs/OPERATIONS.md for the
                               # one-time setup. Or "self-signed" (pin with --pin), or "files" behind Caddy/nginx
auth:
  loopbackTrusted: false
YAML

weave daemon start                # "public listener held" until a password exists — expected
weave daemon set-password         # opens the public listener in place
weave login https://myhost.tailnet-name.ts.net:7433 --device server   # a local context for this host (add --pin with tls.mode self-signed)
weave doctor                      # everything on this host; `--install` for what is missing

# Host-only setup: coding CLIs, git, forge.
weave runtime login claude        # only if the inherited credentials are not enough
gh auth login
ssh-keygen -t ed25519          # and add the key to the forge

weave init ~/Work/acme --prefix ACME --name "Acme Labs"
weave project add git@github.com:acme/api.git --runtime claude

weave daemon stop                 # hand the daemon to systemd
weave daemon install-service      # prints: daemon-reload, enable --now, loginctl enable-linger
```

A firewall on the server must let the Tailscale interface reach the port, e.g.
`sudo ufw allow in on tailscale0 to any port 7433 proto tcp`.

On your **laptop** (CLI only, no daemon; macOS shown, Linux is the same minus brew):

```bash
brew install mise tailscale            # tailscale: join the same tailnet as the server
git clone git@github.com:victornor/agent-conductor.git && cd agent-conductor
mise install && pnpm install && pnpm build
mkdir -p ~/.local/bin && cat > ~/.local/bin/weave <<EOF
#!/bin/sh
exec "$(mise which node)" "$PWD/packages/cli/dist/bin.js" "\$@"
EOF
chmod +x ~/.local/bin/weave               # and make sure ~/.local/bin is on PATH in ~/.zshrc

weave login https://myhost.tailnet-name.ts.net:7433 --pin --device macbook
# --pin shows the daemon's certificate fingerprint and stores it; compare it with
# `weave login` output on the server before typing the password. Then the password,
# then a TOTP code if you enabled TOTP.

weave doctor                              # local tools here, plus "daemon host:" rows for the server
weave chat                                # talk to the weaver
weave top                                 # live agents
weave presenter --surface tmux            # workers as tmux windows on the laptop (hyprland on Linux)
```

**Dashboard** from the laptop: open `https://myhost.tailnet-name.ts.net:7433` in the browser.
The certificate is self-signed, so the browser warns once — Safari: *Show Details → visit this
website*; Chrome: *Advanced → proceed*. Sign in with the operator password. To make the warning
go away for good and enable "Add to Dock" as an app, trust the certificate once:

```bash
# on the laptop, after the first `weave login --pin`
openssl s_client -connect myhost.tailnet-name.ts.net:7433 -servername myhost.tailnet-name.ts.net </dev/null 2>/dev/null \
  | openssl x509 -out ~/Downloads/weaver.crt
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/weaver.crt
```

`weave login` stores a named context in `~/.config/weave/contexts.yaml` (URL, token, default
workspace, cert pin). Every command then works identically against a local or remote daemon.

On your **phone**: open `https://myhost.tailnet-name.ts.net:7433`, accept the self-signed
certificate once, sign in, install the PWA. Same state as the laptop and Telegram. Enable TOTP in
Settings → Security before exposing the daemon beyond a tailnet.

**Telegram** (optional). Put the bot token in `workspace.yaml` as an environment reference and set
the variable on the daemon host:

```yaml
channels:
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}
    allowedUserIds: [12345678]
conductor:
  channels: [web, cli, telegram]
```

---

## Mental model

| Concept | What it is | Lives in |
|---|---|---|
| **Workspace** | A directory + SQLite DB representing one virtual business. One daemon hosts many. | `<dir>/workspace.yaml`, `<dir>/.weave/db.sqlite` |
| **Project** | A git repo cloned into the workspace. Has a default runtime, branch, policies, OpenSpec root. | `<ws>/projects/<id>/` (reference clone, never a cwd) |
| **Weaver** | The one workspace-scoped agent you talk to. Creates tickets, hires roles, assigns, supervises, reports. Read-only on projects. | `<ws>/conductor/` |
| **Role** | A hired template scoped to one project: charter, runtime, model, concurrency limit. Roles do not run. | `<ws>/roles/<id>/role.yaml`, `CHARTER.md` |
| **Worker** | A disposable agent spawned from a role for exactly **one ticket**, with its own home, brief, worktree and session for the ticket's life. Retired once the work lands. | `<ws>/workers/<id>/`, worktree at `work/` |
| **Ticket** | The unit of work: `change`, `task`, `scout` or `question`. Identifier `ACME-42`. | DB, mirrored to `<ws>/tickets/` |
| **Decision** | Anything held for a human (or the weaver): plan approval, hire approval, merge approval, a worker's question, a discard confirmation. | DB, `weave decision`, UI, Telegram buttons |
| **Knowledge base** | Curated, budgeted markdown: the workspace KB (weaver-only), `SHARED.md` (every agent), one `PROJECT.md` per project (that project's workers only). | `<ws>/knowledge/` |
| **Specs** | OpenSpec capabilities and changes per project, indexed and browsable. Specs change only through tickets. | the project repo's `openspec/`, indexed into the DB |
| **Run / wakeup** | One executed agent turn; a durable request to run one. Agents are wake-driven, never polling. | DB, `<ws>/.weave/runs/<runId>/` |
| **Surface** | Where an agent is *shown*: headless, tmux, herdr, Hyprland. Never changes how a run executes. | `presentation:` in `workspace.yaml`, reconciled by `weave presenter` |

Ticket statuses: `backlog → todo → proposing → proposed → approved → in_progress → in_review →
merging → done`, plus `blocked` and `cancelled`.

Three rules worth internalising:

1. **The project boundary is absolute.** A worker's write scope is its own worktree and its own
   ticket. Cross-project work is coordinated through tickets, never shared files.
2. **Evidence is not authorization.** A scout report never authorizes a code change; approval gates
   are explicit state.
3. **A worker never merges without human approval** unless the ticket has `autoMerge` on (off by
   default; the weaver never turns it on by itself).

---

## Command cheat-sheet

Run `weave <group> --help` for the full set. Global flags: `-w/--workspace`, `--json`, `--no-color`,
`--context`, `--url`, `--token` (env: `AC_WORKSPACE`, `AC_API_URL`, `AC_TOKEN`).

### Daemon and access

`weave daemon update apply` asks the running daemon to upgrade itself: it holds dispatch, waits for
every running turn to finish, then builds, backs up, switches `current` and restarts. The web app offers
the same thing under Settings → Updates. `weave daemon upgrade` is the from-this-shell path that
still works when the daemon is not answering; `releases` and `rollback` go with it (see docs/OPERATIONS.md §6).

| Command | Does |
|---|---|
| `weave daemon start [-f] [--listen host:port]` | start the daemon on this machine (`--listen` overrides `http.listen` in `daemon.yaml` for this start) |
| `weave daemon stop \| status \| logs [-f] [-n N]` | lifecycle and the local log |
| `weave daemon set-password [-u operator]` | first-run operator setup, or change the password |
| `weave daemon install-service [--print] [--launchd]` | write `~/.config/systemd/user/weave-ai.service`, or with `--launchd` a macOS LaunchAgent plist (printed on any other platform) |
| `weave daemon update` | running version and commit, the source at its ref, and whether an update is available |
| `weave daemon update apply [--ref R] [--test] [--no-follow]` | queue an upgrade on the daemon; it starts only once no turn is running, and is followed to its outcome |
| `weave daemon update cancel` | cancel a queued or waiting upgrade and resume dispatch |
| `weave login <url> [--pin] [--insecure] [--device N] [--name N]` | sign in, store a context |
| `weave logout [--all] [--forget]` · `weave context list\|use\|remove\|show` | sessions and contexts |
| `weave devices list \| revoke <id> \| revoke --all` | sessions signed in to the daemon |
| `weave doctor` | daemon, runtimes, node, git, gh, workspaces — with the fix for each failure |

### Workspace, projects, runtimes

| Command | Does |
|---|---|
| `weave init <dir> --prefix ACME [--id] [--name] [--local]` | scaffold and register a workspace |
| `weave workspace list \| use <id> \| register <path> \| unregister <id>` | the daemon's workspace registry |
| `weave workspace set-default <key=value...>` | change workspace defaults, e.g. `knowledgeBudgetTokens.project=20000` |
| `weave workspace pause \| resume` | stop and restart run dispatch for the workspace |
| `weave workspace export [--out <dir>]` | portable package on the daemon host: `workspace.yaml`, roles, knowledge, tickets as markdown — no db, no runs, no secrets |
| `weave workspace import <dir> --target <dir>` | copy an export into a new or existing workspace directory and register it; tickets land in `backlog` with an `[imported]` comment |
| `weave project add <git-url> [--id] [--branch] [--max-workers N] [--setup CMD] [--no-follow]` | clone, `openspec init`, seed the KB, create the scout ticket — each sub-step and its output stream to the terminal as it runs |
| `weave project retry <id> [--no-follow]` | re-run an add that failed, reusing whatever is already on disk |
| `weave project list \| show <id> \| remove <id> \| fetch [id]` | projects; `fetch` fast-forwards the primary clone |
| `weave project set-policy <id> <key>=<value>...` | per-project policies (`deliveryMode`, `mergeMethod`, `requireCi`, …) |
| `weave project set-landing-branch <id> [branch] \| --clear` | set, change or clear the branch tickets' work is expected to reach, after the project was added |
| `weave project set-openspec <id> on\|off` | turn a project's OpenSpec mode on or off after it was added; tickets already bound to a change keep their flow (VS-578) |
| `weave project set-policy <id> deleteBranchAfterMerge=true\|false` | delete a ticket's remote branch after its pull request merges; on by default (VS-770) |
| `weave project prune-branches <id> [--dry-run]` | delete the leftover branches of done or cancelled tickets whose work landed (VS-770) |
| `weave project set-policy <id> visualPlanArtifact=true\|false` | experimental, off by default: require a visual artifact with every change plan, shown on its approval card (VS-624) |
| `weave runtime list \| detect \| models <id> \| login <id> [--print]` | coding CLIs and their auth |

### Talking and deciding

| Command | Does |
|---|---|
| `weave say "<text>" [--timeout 180] [--no-wait]` | one-shot message to the weaver; prints the reply |
| `weave chat [ticketId]` | interactive thread; with a ticket it binds to that ticket's worker |
| `weave attach <workerId\|weaver>` | live transcript + steering for one agent |
| `weave top` | one-screen fleet view |
| `weave briefing` | the four-section briefing, rendered from the snapshot (no LLM tokens) |
| `weave decision list [-s open] [--owner human]` | everything waiting on you |
| `weave decision show <id>` · `weave decision answer <id> <key\|N\|text> [--text] [--remember] [--yes]` | answer a decision card |
| `weave decision withdraw <id>` | withdraw one |

### Roles, workers, tickets

| Command | Does |
|---|---|
| `weave role list [-p project] \| show <id>` | roles and their live workers |
| `weave role activate <id> [--runtime] [--model]` | activate a hired role so it picks up tickets |
| `weave role set-max-workers <id> <n>` | change how many workers a role runs at once (1-32; the project limit still applies) |
| `weave role pause \| resume \| retire <id>` · `weave role charter show \| rollback <id> <rev>` | role lifecycle and charter revisions |
| `weave worker list [-p] [-r] [-s] [--all]` · `weave worker show <id>` · `weave worker brief <id>` | live workers |
| `weave worker message <id> <text>` | direct message to a worker (wakes it) |
| `weave worker pause \| resume \| cancel \| relaunch \| purge <id>` | worker lifecycle |
| `weave worker handover <id>` · `weave worker handback <id> --note <note>` | take a worker's session for your own terminal, or give it back (VS-249) |
| `weave ticket create <title...> [-p] [-k kind] [--priority] [-d desc] [--assign role] [--auto-merge] [--parent] [--blocked-by]` | create a ticket |
| `weave ticket list [-p] [-s] [-k] [-r] [--search] [--limit]` · `weave ticket show <id>` | the board in the terminal |
| `weave ticket merge-queue [-p <project>]` | who is landing now and who is waiting behind them |
| `weave ticket assign <id> <roleId>` · `weave ticket set <id> [--title] [--priority] [--auto-merge]` | edit |
| `weave ticket transition <id> <status> [--note] [--blocked-by]` | move through the state machine |
| `weave ticket comment <id> <body...>` · `weave ticket comments <id>` | talk to the live worker on its ticket |
| `weave ticket cancel <id>` · `weave ticket discard <id> --force` | cancel; discard needs an approved decision |
| `weave ticket open <id> [--pr] [--print]` | open the ticket or its PR in a browser |

### Watching, knowledge, specs, cost

| Command | Does |
|---|---|
| `weave runs list [-a] [-t] [-s] [--limit]` · `weave runs show <id> [--raw]` · `weave runs tail <id>` · `weave runs cancel <id> [--mode kill]` | the run log |
| `weave usage [--scope workspace\|project:<id>\|role:<id>\|worker:<id>\|ticket:<id>\|model:<id>] [--window 24h\|today\|7d\|week\|month\|all] [--grain hour\|day\|week] [--by model\|ticket\|role\|worker\|project] [--series] [--sync [--runtime <id>]]` | tokens and cost; `--sync` probes the plan limits now |
| `weave knowledge lint` | sizes, budgets, curation state for every KB |
| `weave knowledge show \| edit \| note \| revisions \| revert \| curate <scope> [-p project]` | scopes: `workspace`, `shared`, `decisions`, `project` |
| `weave specs list \| show <capability> \| changes [name] \| search <q> \| explore [project]` | the spec index |
| `weave worktree list \| verify <id> \| discard <id> [--force]` | worktrees and landed-work verdicts |
| `weave weaver show \| reset-session` | the weave agent |
| `weave models` · `weave models set conductor\|weaver\|workers --runtime <id> --model <id\|default> [--effort <e>]` · `weave models inherit conductor\|weaver\|workers\|options` · `weave models options add\|set\|remove` | the workspace's two model settings and the worker-options catalog; each control writes on its own, inherit clears one |
| `weave presentation status \| set <path> <value> \| reconcile \| open` | where agents are shown |
| `weave presenter [--surface tmux\|hyprland\|herdr\|headless] [--once]` | run this on the machine you look at |

`weave agent inbox|report|ask|human` exists for agents inside a run (needs `AC_RUN_TOKEN`); humans
never call it.

---

## Configuration files

### `~/.config/weave/` (daemon host; `$XDG_CONFIG_HOME/weave` when set)

| File | What |
|---|---|
| `daemon.yaml` | listener, TLS, auth, transcription, log level |
| `workspaces.yaml` | the registry: `workspaces: [{ id, path }]` |
| `contexts.yaml` | client-side: named daemon contexts (URL, token, workspace, cert pin), mode 0600 |
| `daemon.sqlite` | operator account, sessions, TOTP |
| `daemon.json` | pid file written by the running daemon (pid, publicUrl, loopbackUrl) |
| `self-signed.crt` / `.key` | generated on first start when `tls.mode: self-signed` |

`~/.local/state/weave/` holds `daemon.pid` and `daemon.log` for a daemon started with
`weave daemon start`.

**`daemon.yaml`** — the keys that matter:

```yaml
version: 1
http:
  listen: 127.0.0.1:7433      # host:port
  publicUrl: https://conductor.example.com   # what clients should use; defaults from listen
  trustProxy: false           # only then are X-Forwarded-* honoured
  tls:
    mode: none                # none | self-signed | tailscale | files (acme is not implemented)
    cert: /path/fullchain.pem # mode: files
    key: /path/privkey.pem
    domains: [conductor.example.com] # SANs for self-signed; the certificate name for tailscale (default: this node's tailnet name)
auth:
  loopbackTrusted: false      # true = no password required, loopback only
  sessionDaysNamed: 30        # named devices
  sessionHoursUnnamed: 12     # unnamed browser sessions
  lockoutAttempts: 5
  lockoutMinutes: 15
transcription:
  backend: chrome             # chrome (Web Speech, default) | voxtype
  model: ""                   # Voxtype model id when backend is voxtype
  provider: none              # none | command (yaml-only stdin transcribe)
  command: ""                 # reads audio on stdin, prints the transcript
logLevel: info
otlpEndpoint: ""              # unset = no export; there is no phone-home
```

### `<workspace>/workspace.yaml`

The declared configuration. The DB is runtime state; on start the daemon reconciles the two. Secrets
are only ever `${ENV_VAR}` references, resolved on the daemon host and written back unresolved.

```yaml
version: 1
id: acme                      # kebab-case slug; this is `:ws` in the API
name: Acme Labs
ticketPrefix: ACME            # tickets are ACME-1, ACME-2, ...
models:                       # all of model selection, per workspace (ADR 0011)
  conductor:
    runtime: claude
    model: claude-fable-5-1   # null = the runtime's default
  workers:
    runtime: claude           # every worker, whatever its role or project
    model: claude-opus-5
    effort: high              # optional; the only place effort can be set
defaults:
  proposalApproval: human     # human | conductor | none
  hireApproval: human
  deliveryMode: pr            # pr | local-branch
  autoMerge: false            # per-ticket flag's default; off means a merge decision every time
  worktrees: worktrunk        # worktrunk | git
  maxConcurrentRuns: 6
  turnTimeoutSec: 2700
  silenceTimeoutSec: 600      # the stuck-worker watchdog window
  bootstrapBudgetTokens: 16000
  knowledgeBudgetTokens:        # tokens per knowledge file; curation is triggered at 80% of it
    workspace: 10000
    shared: 2000
    decisions: 4000
    project: 10000
    document: 10000
  permissionMode: auto        # auto | restricted | bypass
projects:
  - id: api
    url: git@github.com:acme/api.git
    defaultBranch: main
    maxWorkers: 4             # concurrent workers across all roles in this project
    setupCommand: pnpm install   # run once per new worktree
    warmPaths: [node_modules]    # gitignored caches copied into a new worktree (git provider)
    worktrees: worktrunk         # per-project override
    openspec: { enabled: true }
    policies:
      proposalApproval: conductor
      mergeMethod: squash        # squash | merge | rebase
      deliveryMode: pr
      autoMergeDefault: false
      archiveCommit: push        # push | pr | local
      requireCi: true            # false merges on an absent check rollup; see below
conductor:                    # its runtime and model are `models.conductor`, above
  channels: [web, cli, telegram]
  humanName: Victor            # how agents address you; "captain" when unset
presentation:
  default: headless
  conductor: { surface: terminal }
  workers: { surface: hyprland, workspace: 5, layout: grid }
  # or: { surface: herdr, workspace: acme, tabPerProject: true }
  # or: { surface: tmux, session: ac-acme }
channels:
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}
    allowedUserIds: [12345678]
webhooks:                     # at-least-once, HMAC-SHA256 signed POSTs from the events outbox
  - url: https://hooks.acme.dev/conductor
    events: [ticket.*, decision.created]   # exact names, `prefix.*`, or `*`
    secret: ${AC_WEBHOOK_SECRET}           # signs the body as X-WeaveAI-Signature: sha256=<hex>
plugins: []                   # npm package names, or ./paths relative to the workspace root (see examples/plugins/)
```

**`requireCi` and the landing gate.** With the default `requireCi: true`, the daemon never merges a pull request on an absent, all-skipped, cancelled or wrong-head check rollup of a repository that has GitHub Actions workflow files: it waits for a successful run on the exact head it lands. A repository with **no** workflow files (dynamic workflows such as Dependabot updates and disabled workflows do not count) has nothing that can ever report, so it lands without waiting and the ticket gets one comment saying it landed without CI because the repository has none. If the forge cannot say (the query keeps failing), the daemon retries it and otherwise waits at most ten minutes, measured from its first attempt for that head, before landing as for a repository with no CI. `requireCi: false` is the explicit override: the daemon merges on an absent rollup without asking the forge at all.

### `<workspace>/roles/<id>/role.yaml`

Written by the daemon when the weaver hires a role; you normally edit it through the UI. Key
fields: `id`, `name`, `project`, `charterSummary`, `scope`, `responsibilities[]`, `capabilities[]`,
`exclusions[]`, `rules[]`, `sessionPolicy` (`per_ticket` by default), `maxWorkers`,
`permission.{mode,allowed,denied}`. A role names no runtime or model: every worker runs on the
workspace's `models.workers` setting (ADR 0011).
The prose charter lives beside it in `CHARTER.md` and is revisioned; `OVERRIDES.md` is yours.

---

## Runtime status

| Runtime | Adapter | Live status |
|---|---|---|
| `claude` (Claude Code) | reference adapter; every capability — resume, fork, structured output, MCP, per-turn usage and cost | **verified live** |
| `opencode` | full adapter; `file_only` prompt injection, JSON event stream, models detected from `opencode models` | **verified live** |
| `codex` | full adapter (`codex exec --json`, `CODEX_HOME` isolation, `--output-schema`), fixtures-tested | implemented, **not yet verified against a live account** |
| `gemini` | full adapter (`gemini -p -o stream-json`, `GEMINI.md` discovery), fixtures-tested; no session fork | implemented, **not yet verified against a live account** |

All four are registered by the daemon at start; a runtime whose CLI is missing shows as
`missing` in `weave runtime list` and `weave doctor` rather than breaking anything. Adding a fifth is a
plugin: implement `RuntimeAdapter` from `@weave-ai/runtime-sdk` and list the package under
`plugins:` in `workspace.yaml`.

Channels shipped: `web`, `cli`, `telegram`. Surfaces shipped: `headless`, `tmux`, `herdr`,
`hyprland`. Worktree providers: `worktrunk` (default) and `git` (fallback). Forge support is `gh`.

---

## Plugins

A plugin can add:

- a **runtime**, **channel**, **surface**, **forge**, or **worktree provider** (see Runtime status,
  above);
- a **hook**, subscribed to workspace events;
- an **agent tool** — an extra MCP tool, namespaced `<pluginId>_<name>`, scoped to the weaver,
  workers, or both;
- its own **storage** — a durable, per-plugin document store in the workspace database;
- **HTTP routes**, mounted under `/api/w/:ws/plugins/<pluginId>/…`, behind the normal session auth;
- a **page**, rendered at `/w/:ws/plugins/<pluginId>` in a sandboxed iframe with a nav entry, plus
  live events on the workspace's existing stream.

**Enable one** by listing it under `plugins:` in a workspace's `workspace.yaml` (that workspace
only) or in `daemon.yaml` (every workspace this daemon serves). A relative path resolves against
the workspace root; restart the daemon after changing the list.

**Trust model.** Plugins are ordinary npm packages or local directories, loaded **in process** at
daemon start — trusted code, not sandboxed. A plugin cannot override a core invariant (ticket
checkout/transition guards, approval ownership, the auto-merge gate, the project boundary) because
those APIs are never exposed to it. A plugin's *page*, by contrast, runs in an opaque-origin iframe
that cannot read the viewer's session or call the API directly — it talks to the daemon only through
a scoped postMessage bridge the host page runs.

```js
import { definePlugin } from '@weave-ai/plugin-sdk';

export default definePlugin({
  id: 'notes',
  version: '0.1.0',
  apiVersion: 1,
  register(host) {
    host.registerAgentTool({
      name: 'notes_create', description: 'Add a note.', scope: 'all',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      handler: async (input) => { /* ... */ },
    });
  },
});
```

The full authoring guide is [`docs/PLUGINS.md`](docs/PLUGINS.md); a complete worked example —
a tool, storage, a route, and a page — is [`examples/plugins/notes/`](examples/plugins/notes/).

---

## Licence and contributing

Weave AI is licensed under the **GNU Affero General Public License v3.0** ([`LICENSE`](LICENSE)).
Paid features live in [`ee/`](ee/) under a separate commercial licence ([`ee/LICENSE`](ee/LICENSE)):
free to read, build, modify and test, but production use needs a licence key.

Contributions are welcome. By submitting one you accept the contributor licence agreement in
[`CLA.md`](CLA.md), which lets the project relicense your work — including into `ee/`. Read
[`CLAUDE.md`](CLAUDE.md) for the repo's conventions before you open a pull request.
