# OpenConductor

OpenConductor turns a directory into a **workspace**: a virtual business made of one or more git
projects, staffed by AI agents with well-defined roles and coordinated by one **conductor** agent
that you talk to. You say "add dark mode to the dashboard"; the conductor turns that into a ticket,
hires a role for the project if none fits, and a disposable **worker** picks it up in its own git
worktree, proposes a plan, waits for your approval, implements it, opens a PR, and merges it once
you approve. You never manage the mechanics — state transitions, worktrees, locks, git operations,
OpenSpec state, cost accounting are all code; only judgment is left to agents.

The daemon is a **server**. It holds the workspaces, the coding CLIs and their credentials, the git
and forge credentials, and the channel bots. Everything else is a client: the web app (an
installable PWA), the `oc` CLI, Telegram. Nothing on your laptop needs to be running for work to
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
- [`docs/SCENARIOS.md`](docs/SCENARIOS.md) — end-to-end walkthroughs of what each participant sees.
- [`docs/demos/`](docs/demos/) — reproducible M1–M6 demo scripts against the real commands.
- [`docs/design/DESIGN-CONTRACT.md`](docs/design/DESIGN-CONTRACT.md) — tokens, components, screens, states.
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
| `worktrunk` (`wt`) | optional, recommended — `pacman -S worktrunk`. Without it set `worktrees: git` (the built-in `git worktree` fallback). |

## Build

```bash
mise install                 # node + pnpm, if you use mise
pnpm install
pnpm build                   # tsc -b across every package
pnpm --filter @openconductor/ui build    # the web app -> packages/ui/dist
```

Then either run the binaries directly:

```bash
node packages/server/dist/bin.js   # the daemon
node packages/cli/dist/bin.js      # the CLI
```

or put `oc` on your PATH:

```bash
cd packages/cli && pnpm link --global    # or: npm link
oc --help
```

Everything below assumes `oc` is linked. Where it is not, substitute
`node packages/cli/dist/bin.js`.

Root scripts: `pnpm build`, `pnpm test` (vitest), `pnpm lint` (the boundary and console guards),
`pnpm typecheck`, `pnpm dev` (daemon in the foreground).

---

## Quickstart A — one machine, local development

```bash
# 1. Trust loopback so you can skip the password while developing.
mkdir -p ~/.config/openconductor
cat > ~/.config/openconductor/daemon.yaml <<'YAML'
version: 1
http:
  listen: 127.0.0.1:7433
auth:
  loopbackTrusted: true
YAML

# 2. Start the daemon.
oc daemon start
oc daemon status

# 3. Create a workspace. It is scaffolded on the daemon host and registered.
oc init ~/Work/acme --prefix ACME --name "Acme Labs"

# 4. Make sure a coding CLI is available and authenticated.
oc runtime list
oc runtime login claude        # only if the inherited credentials are not enough

# 5. Add a project. Clones it, runs `openspec init`, seeds the project KB,
#    and creates a scout ticket that describes the repo.
oc project add git@github.com:acme/api.git --runtime claude

# 6. Talk to the conductor.
oc say "what is in this workspace?"
oc chat                        # interactive
oc doctor                      # green checklist, or exactly what is missing
```

Open <http://127.0.0.1:7433> for the web app. If it shows "the web UI has not been built", run
`pnpm --filter @openconductor/ui build` and reload.

**Credentials.** When a workspace loads, the daemon copies the host user's coding-CLI credentials
into a per-workspace config home under `<workspace>/.openconductor/runtimes/<runtime>/` — it never
reads or writes your personal CLI config afterwards. Copied files:

| Runtime | From | Config-home env |
|---|---|---|
| `claude` | `~/.claude/.credentials.json` | `CLAUDE_CONFIG_DIR` |
| `codex` | `~/.codex/auth.json` | `CODEX_HOME` |
| `gemini` | `~/.gemini/oauth_creds.json`, `google_accounts.json` | `GEMINI_CLI_HOME` |
| `opencode` | `~/.local/share/opencode/auth.json` | `XDG_CONFIG_HOME` |

If a runtime was not logged in on the host when the workspace first loaded, run
`oc runtime login <id>` — it runs that CLI's own login flow with the env pointed at the workspace
config home.

## Quickstart B — daemon on a server, work from a laptop and a phone

On the **server** (the daemon host — this is where code runs, where the coding CLIs live, and where
git credentials live):

```bash
# Build as above, then configure the listener.
cat > ~/.config/openconductor/daemon.yaml <<'YAML'
version: 1
http:
  listen: 0.0.0.0:7433
  publicUrl: https://oc.example.com
  tls:
    mode: self-signed          # or "files" behind Caddy/nginx; see docs/OPERATIONS.md
    domains: [oc.example.com]
auth:
  loopbackTrusted: false
YAML

oc daemon start
oc daemon set-password         # POSTs /api/auth/setup on first run

# Host-only setup: coding CLIs, git, forge.
oc runtime login claude
gh auth login
ssh-keygen -t ed25519          # and add the key to the forge

oc init ~/work/acme --prefix ACME --name "Acme Labs"
oc project add git@github.com:acme/api.git --runtime claude
oc doctor

oc daemon install-service      # systemd user unit; prints the enable commands
```

The daemon refuses to listen on a non-loopback address with no operator password configured.

On your **laptop**:

```bash
oc login https://oc.example.com --pin --device laptop
# --pin trusts the daemon's self-signed certificate and stores the fingerprint.
# It prompts for the password, then for a TOTP code if you enabled TOTP.

oc context list
oc chat
oc top
oc presenter --surface hyprland        # live workers as windows on this machine
```

`oc login` stores a named context in `~/.config/openconductor/contexts.yaml` (URL, token, default
workspace, cert pin). Every command then works identically against a local or remote daemon.

On your **phone**: open `https://oc.example.com`, sign in, install the PWA. Same state as the
laptop and Telegram. Enable TOTP in Settings → Security before exposing the daemon publicly.

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
| **Workspace** | A directory + SQLite DB representing one virtual business. One daemon hosts many. | `<dir>/workspace.yaml`, `<dir>/.openconductor/db.sqlite` |
| **Project** | A git repo cloned into the workspace. Has a default runtime, branch, policies, OpenSpec root. | `<ws>/projects/<id>/` (reference clone, never a cwd) |
| **Conductor** | The one workspace-scoped agent you talk to. Creates tickets, hires roles, assigns, supervises, reports. Read-only on projects. | `<ws>/conductor/` |
| **Role** | A hired template scoped to one project: charter, runtime, model, concurrency limit. Roles do not run. | `<ws>/roles/<id>/role.yaml`, `CHARTER.md` |
| **Worker** | A disposable agent spawned from a role for exactly **one ticket**, with its own home, brief, worktree and session for the ticket's life. Retired once the work lands. | `<ws>/workers/<id>/`, worktree at `work/` |
| **Ticket** | The unit of work: `change`, `task`, `scout` or `question`. Identifier `ACME-42`. | DB, mirrored to `<ws>/tickets/` |
| **Decision** | Anything held for a human (or the conductor): plan approval, hire approval, merge approval, a worker's question, a discard confirmation. | DB, `oc decision`, UI, Telegram buttons |
| **Knowledge base** | Curated, budgeted markdown: the workspace KB (conductor-only), `SHARED.md` (every agent), one `PROJECT.md` per project (that project's workers only). | `<ws>/knowledge/` |
| **Specs** | OpenSpec capabilities and changes per project, indexed and browsable. Specs change only through tickets. | the project repo's `openspec/`, indexed into the DB |
| **Run / wakeup** | One executed agent turn; a durable request to run one. Agents are wake-driven, never polling. | DB, `<ws>/.openconductor/runs/<runId>/` |
| **Surface** | Where an agent is *shown*: headless, tmux, herdr, Hyprland. Never changes how a run executes. | `presentation:` in `workspace.yaml`, reconciled by `oc presenter` |

Ticket statuses: `backlog → todo → proposing → proposed → approved → in_progress → in_review →
merging → done`, plus `blocked` and `cancelled`.

Three rules worth internalising:

1. **The project boundary is absolute.** A worker's write scope is its own worktree and its own
   ticket. Cross-project work is coordinated through tickets, never shared files.
2. **Evidence is not authorization.** A scout report never authorizes a code change; approval gates
   are explicit state.
3. **A worker never merges without human approval** unless the ticket has `autoMerge` on (off by
   default; the conductor never turns it on by itself).

---

## Command cheat-sheet

Run `oc <group> --help` for the full set. Global flags: `-w/--workspace`, `--json`, `--no-color`,
`--context`, `--url`, `--token` (env: `OC_WORKSPACE`, `OC_API_URL`, `OC_TOKEN`).

### Daemon and access

| Command | Does |
|---|---|
| `oc daemon start [-f] [--listen host:port]` | start the daemon on this machine (`--listen` overrides `http.listen` in `daemon.yaml` for this start) |
| `oc daemon stop \| status \| logs [-f] [-n N]` | lifecycle and the local log |
| `oc daemon set-password [-u operator]` | first-run operator setup, or change the password |
| `oc daemon install-service [--print]` | write `~/.config/systemd/user/openconductor.service` |
| `oc login <url> [--pin] [--insecure] [--device N] [--name N]` | sign in, store a context |
| `oc logout [--all] [--forget]` · `oc context list\|use\|remove\|show` | sessions and contexts |
| `oc devices list \| revoke <id> \| revoke --all` | sessions signed in to the daemon |
| `oc doctor` | daemon, runtimes, node, git, gh, workspaces — with the fix for each failure |

### Workspace, projects, runtimes

| Command | Does |
|---|---|
| `oc init <dir> --prefix ACME [--id] [--name] [--local]` | scaffold and register a workspace |
| `oc workspace list \| use <id> \| register <path> \| unregister <id>` | the daemon's workspace registry |
| `oc project add <git-url> [--id] [--runtime] [--branch] [--max-workers N] [--setup CMD]` | clone, `openspec init`, seed the KB, create the scout ticket |
| `oc project list \| show <id> \| remove <id> \| fetch [id]` | projects; `fetch` fast-forwards the primary clone |
| `oc runtime list \| detect \| models <id> \| login <id> [--print]` | coding CLIs and their auth |

### Talking and deciding

| Command | Does |
|---|---|
| `oc say "<text>" [--timeout 180] [--no-wait]` | one-shot message to the conductor; prints the reply |
| `oc chat [ticketId]` | interactive thread; with a ticket it binds to that ticket's worker |
| `oc attach <workerId\|conductor>` | live transcript + steering for one agent |
| `oc top` | one-screen fleet view |
| `oc briefing` | the four-section briefing, rendered from the snapshot (no LLM tokens) |
| `oc decision list [-s open] [--owner human]` | everything waiting on you |
| `oc decision show <id>` · `oc decision answer <id> <key\|N\|text> [--text] [--remember] [--yes]` | answer a decision card |
| `oc decision withdraw <id>` | withdraw one |

### Roles, workers, tickets

| Command | Does |
|---|---|
| `oc role list [-p project] \| show <id>` | roles and their live workers |
| `oc role activate <id> [--runtime] [--model]` | activate a hired role so it picks up tickets |
| `oc role set-runtime <id> <rt>` · `oc role set-model <id> <model\|default>` | change where a role's workers run |
| `oc role pause \| resume \| retire <id>` · `oc role charter show \| rollback <id> <rev>` | role lifecycle and charter revisions |
| `oc worker list [-p] [-r] [-s] [--all]` · `oc worker show <id>` · `oc worker brief <id>` | live workers |
| `oc worker message <id> <text>` | direct message to a worker (wakes it) |
| `oc worker pause \| resume \| cancel \| relaunch \| purge <id>` | worker lifecycle |
| `oc ticket create <title...> [-p] [-k kind] [--priority] [-d desc] [--assign role] [--auto-merge] [--parent] [--blocked-by]` | create a ticket |
| `oc ticket list [-p] [-s] [-k] [-r] [--search] [--limit]` · `oc ticket show <id>` | the board in the terminal |
| `oc ticket assign <id> <roleId>` · `oc ticket set <id> [--title] [--priority] [--auto-merge]` | edit |
| `oc ticket transition <id> <status> [--note] [--blocked-by]` | move through the state machine |
| `oc ticket comment <id> <body...>` · `oc ticket comments <id>` | talk to the live worker on its ticket |
| `oc ticket cancel <id>` · `oc ticket discard <id> --force` | cancel; discard needs an approved decision |
| `oc ticket open <id> [--pr] [--print]` | open the ticket or its PR in a browser |

### Watching, knowledge, specs, cost

| Command | Does |
|---|---|
| `oc runs list [-a] [-t] [-s] [--limit]` · `oc runs show <id> [--raw]` · `oc runs tail <id>` · `oc runs cancel <id> [--mode kill]` | the run log |
| `oc usage [--scope workspace\|project:<id>\|role:<id>\|worker:<id>\|ticket:<id>\|model:<id>] [--window 24h\|today\|7d\|week\|month\|all] [--grain hour\|day\|week] [--by model\|ticket\|role\|worker\|project] [--series]` | tokens and cost |
| `oc knowledge lint` | sizes, budgets, curation state for every KB |
| `oc knowledge show \| edit \| note \| revisions \| revert \| curate <scope> [-p project]` | scopes: `workspace`, `shared`, `decisions`, `project` |
| `oc specs list \| show <capability> \| changes [name] \| search <q> \| explore [project]` | the spec index |
| `oc worktree list \| verify <id> \| discard <id> [--force]` | worktrees and landed-work verdicts |
| `oc conductor show \| set-runtime <rt> \| set-model <m> \| reset-session` | the conductor's own configuration |
| `oc presentation status \| set <path> <value> \| reconcile \| open` | where agents are shown |
| `oc presenter [--surface tmux\|hyprland\|herdr\|headless] [--once]` | run this on the machine you look at |

`oc agent inbox|report|ask|human` exists for agents inside a run (needs `OC_RUN_TOKEN`); humans
never call it.

---

## Configuration files

### `~/.config/openconductor/` (daemon host; `$XDG_CONFIG_HOME/openconductor` when set)

| File | What |
|---|---|
| `daemon.yaml` | listener, TLS, auth, transcription, log level |
| `workspaces.yaml` | the registry: `workspaces: [{ id, path }]` |
| `contexts.yaml` | client-side: named daemon contexts (URL, token, workspace, cert pin), mode 0600 |
| `daemon.sqlite` | operator account, sessions, TOTP |
| `daemon.json` | pid file written by the running daemon (pid, publicUrl, loopbackUrl) |
| `self-signed.crt` / `.key` | generated on first start when `tls.mode: self-signed` |

`~/.local/state/openconductor/` holds `daemon.pid` and `daemon.log` for a daemon started with
`oc daemon start`.

**`daemon.yaml`** — the keys that matter:

```yaml
version: 1
http:
  listen: 127.0.0.1:7433      # host:port
  publicUrl: https://oc.example.com   # what clients should use; defaults from listen
  trustProxy: false           # only then are X-Forwarded-* honoured
  tls:
    mode: none                # none | self-signed | files | acme (acme not implemented; use a proxy)
    cert: /path/fullchain.pem # mode: files
    key: /path/privkey.pem
    domains: [oc.example.com] # SANs for self-signed
auth:
  loopbackTrusted: false      # true = no password required, loopback only
  sessionDaysNamed: 30        # named devices
  sessionHoursUnnamed: 12     # unnamed browser sessions
  lockoutAttempts: 5
  lockoutMinutes: 15
transcription:
  provider: none              # none | command
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
defaults:
  runtime: claude             # default runtime for new projects
  model: null                 # null = the runtime's default
  proposalApproval: human     # human | conductor | none
  hireApproval: human
  deliveryMode: pr            # pr | local-branch
  autoMerge: false            # per-ticket flag's default; off means a merge decision every time
  worktrees: worktrunk        # worktrunk | git
  maxConcurrentRuns: 6
  turnTimeoutSec: 2700
  silenceTimeoutSec: 600      # the stuck-worker watchdog window
  bootstrapBudgetTokens: 8000
  permissionMode: auto        # auto | restricted | bypass
projects:
  - id: api
    url: git@github.com:acme/api.git
    defaultBranch: main
    runtime: codex            # default runtime for roles hired into this project
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
      requireCi: true
conductor:
  runtime: claude
  model: null
  channels: [web, cli, telegram]
  humanName: Victor            # how agents address you; "captain" when unset
presentation:
  default: headless
  conductor: { surface: terminal }
  workers: { surface: hyprland, workspace: 5, layout: grid }
  # or: { surface: herdr, workspace: acme, tabPerProject: true }
  # or: { surface: tmux, session: oc-acme }
channels:
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}
    allowedUserIds: [12345678]
webhooks: []
plugins: []                   # npm package names or ./relative/paths
```

### `<workspace>/roles/<id>/role.yaml`

Written by the daemon when the conductor hires a role; you normally edit it through
`oc role set-runtime|set-model` or the UI. Key fields: `id`, `name`, `project`, `charterSummary`,
`scope`, `responsibilities[]`, `capabilities[]`, `exclusions[]`, `rules[]`, `runtime`, `model`,
`sessionPolicy` (`per_ticket` by default), `maxWorkers`, `permission.{mode,allowed,denied}`.
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
`missing` in `oc runtime list` and `oc doctor` rather than breaking anything. Adding a fifth is a
plugin: implement `RuntimeAdapter` from `@openconductor/runtime-sdk` and list the package under
`plugins:` in `workspace.yaml`.

Channels shipped: `web`, `cli`, `telegram`. Surfaces shipped: `headless`, `tmux`, `herdr`,
`hyprland`. Worktree providers: `worktrunk` (default) and `git` (fallback). Forge support is `gh`.
