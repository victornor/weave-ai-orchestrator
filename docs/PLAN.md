# AgentConductor — Implementation Plan

Status: **v0.3 (2026-09-03).** Second review folded in: hired **roles** spawn a fresh **worker** per ticket (firstmate's crewmate model) instead of one persistent agent per project, and worktrees are managed by a provider interface with **worktrunk** as the default. §23 is the decision log. Written for handoff to an implementing agent (Opus 5). Every section is a decision unless it is listed under "Open questions". Iterate on this file; do not fork it.

Companion files:
- `docs/research/{firstmate,paperclip,synapse,openspec}.md` — what we took from each inspiration, with verbatim prompt text and interface shapes.
- `docs/research/worktrunk.md` — the verified CLI contract of the default worktree provider.
- `docs/prompts/conductor.AGENTS.md` — draft conductor system prompt.
- `docs/prompts/worker.AGENTS.md.tmpl` — draft worker instruction file (role charter + ticket brief) as a worker sees it.
- `docs/prompts/skills.md` — the skills AgentConductor ships to agents (outline + key rules).

## Implementation status (2026-09-04)

Implemented and verified on this machine against the real Claude Code CLI (see `docs/demos/`): M0–M3 core paths and most of M4–M6.

| Area | Status |
|---|---|
| Daemon, multi-workspace, HTTP API, MCP tools, SSE, auth (password, TOTP, devices, lockout), self-signed TLS with CLI pinning, systemd unit, crash recovery (orphan process kill + retry) | done, verified live |
| Conductor loop, hiring with approval and runtime switch, ticket intake, outcome-language replies | done, verified live |
| Roles → workers, briefs, worktrees (git provider verified; worktrunk provider implemented), OpenSpec propose → plan approval → apply → in_review → merge → archive, auto-merge, landed-work retirement | done, verified live |
| Knowledge bases with budgets, notes, curation workers, spec index and explorer | done, curation and spec index verified live |
| Usage collection and analytics | done |
| Channels: web, cli, telegram (unit-tested; no live bot in this environment) | done |
| Surfaces: headless, tmux (verified), herdr and hyprland (implemented against the real CLIs, not exercised on a live desktop here) and the client-side presenter | done |
| Web UI (React, PWA, both themes) served by the daemon; `conductor` CLI; Ink TUI (`conductor chat` verified inside tmux) | done |
| Runtimes: claude verified live end to end (conductor + workers); opencode verified live end to end (a hired Docs Writer role answered a question ticket through the MCP tools on a free model); codex and gemini implemented from documented formats, unverified live (no credentials here) | partial |
| Routines (cron/webhook triggers), push notifications sending, ACME TLS | schema/stubs only; use a reverse proxy for ACME |

Deviations from the plan are recorded in `docs/adr/`.

---

## 0. How to read this

1. Read §1–§3 for intent and vocabulary.
2. Read §4–§7 for the runtime architecture (this is where most implementation risk lives).
3. §8–§17 are the subsystems. Each ends with an "Implementation notes" block naming modules and tests.
4. §22 is the milestone plan with acceptance criteria. Build in that order.
5. §23 lists open questions for the human. Proceed under the stated assumptions until answered.

Conventions in this document:
- **MUST / MUST NOT** are hard requirements. **SHOULD** is a default that can be changed with a stated reason.
- `code` names are real identifiers the implementation must use (tables, fields, tool names, CLI commands), so that this plan doubles as the naming contract.
- "Human" is the person operating the workspace. In prompts, agents address them by the name in `knowledge/WORKSPACE.md`; when no name is configured the address is "captain". Never "user".

---

## 1. Vision

AgentConductor turns a directory into a **workspace**: a virtual business made of one or more git projects, staffed by AI agents with well-defined roles, coordinated by one **conductor** agent that the human talks to.

- The human talks to the conductor (web, CLI, Telegram, anything with a channel adapter), or directly to a live worker through its ticket.
- The conductor turns requests into **tickets**, hires **roles** when no suitable one exists, assigns tickets to roles, supervises the workers that spawn from them, and reports outcomes in plain language.
- Project work is done by **workers**: disposable agents spawned from a hired **role** (a template: charter, runtime, model) for exactly one ticket, in their own git worktree, with one session that lasts the ticket's whole life (propose → approval → apply → merge). Workers never cross the project boundary and run on whatever coding CLI the human chose for that project (Claude Code, Codex, OpenCode, Gemini CLI). Concurrency is simply more workers. Familiarity with a project lives in the project's knowledge base and the repo's own instructions, not in a long-lived chat.
- Everything is logged: every run, event, token, and cent is attributed to a workspace, project, agent, ticket, and run.
- **The daemon is a server.** It runs wherever the code should run (your workstation, a home server, a VPS), holds the workspaces, the coding CLIs and the git credentials, and is reached from anywhere: the web app on a phone, the `conductor` CLI on a laptop, Telegram. Nothing on the client needs to run for work to progress. Remote access is password-gated and encrypted by default; the only unauthenticated mode is an explicit loopback-only setting.
- Everything is open: runtimes, channels, hooks, tools, storage and presentation surfaces are plugins behind small interfaces; the control plane is a documented HTTP + MCP API.
- Two first-class front doors with equal polish: a web app (chat, monitoring, tickets, org, analytics) and the terminal (an `conductor` TUI for chat and per-worker monitoring). A power user on Hyprland can talk to the conductor in a terminal and have every live worker in its own window on a dedicated Hyprland workspace, or in herdr tabs and panes; a web user gets the same in the browser. Execution is identical underneath; only the surface differs.

### 1.1 Principles (in priority order)

1. **Project boundary is absolute.** A worker's write scope is its own worktree and its own ticket. The conductor never writes into a project. Cross-project work is coordinated through tickets, never through shared files or direct agent-to-agent chat.
2. **Scripts own mechanics, agents own judgment** (firstmate). Anything exact and repeatable (state transitions, locks, git operations, OpenSpec state reads, cost math) is code. Anything requiring understanding (intake, hiring, planning, reviewing, reporting) is an agent.
3. **Durable state, disposable context.** A restart of the daemon or of any agent session is a non-event: tickets, runs, wakeups, decisions and memory live in the database and on disk, never only in a conversation.
4. **Wake-driven, not polling-driven** (paperclip, Synapse). Agents run in turns triggered by durable wakeups. Idle agents cost nothing. Every suppressed wake is recorded with a reason.
5. **Context economy is a feature.** One session per worker for the life of its ticket (no rebuild per turn, no cross-ticket noise), a persistent session only for the conductor, bounded bootstrap digests, a budgeted project knowledge base instead of ad-hoc re-discovery, progressive-disclosure skills, explicit token budgets for everything always-loaded, and scheduled curation so knowledge files never grow without bound.
6. **Evidence is not authorization.** A report, a finding, or a proposal never authorizes code changes. Approval gates are explicit state, not prose.
7. **One name per concept**, in the DB, API, UI, skills and prompts: workspace, project, role, worker, conductor, ticket, run, wakeup, decision, channel, runtime, surface. (Paperclip's issue/task split is the cautionary tale.)
8. **Small always-loaded surface.** The conductor's always-loaded instructions stay under 200 lines; everything conditional goes into skills loaded on trigger (firstmate's 589-line AGENTS.md is the cautionary tale).
9. **SOLID at the seams.** Runtimes, channels, storage and hooks are interfaces with one registration point each; adding one means adding a file, not editing shared code. No plugin may override core invariants (checkout, approvals, budgets, project boundary).
10. **No phone-home.** Telemetry stays local. OTLP export only when the operator configures an endpoint.
11. **Remote by default.** Every feature works over the network against a daemon on another machine; there is no "local-only" code path in the clients. Anything that must be on the daemon host (running agents, git, secrets, channels) stays there; anything that is a view (web, TUI, terminal windows) runs on the client.

---

## 2. Concepts and glossary

| Term | Definition | Notes |
|---|---|---|
| **Workspace** | A directory + database representing one virtual business. Contains projects, roles, tickets, knowledge, channels, usage records. | One daemon instance can host several workspaces; v1 targets one. |
| **Project** | A git repository cloned into the workspace from a URL. Has a default runtime, a default branch, approval policies, and an OpenSpec root. | Project id is a kebab-case slug. |
| **Conductor** | The single workspace-scoped agent the human talks to. Creates tickets, hires agents, assigns, supervises, reports. Read-only on projects. | Exactly one per workspace. It *is* an agent (role `conductor`) running on a runtime, with its own persistent session. |
| **Role** | A hired template scoped to one project: charter (responsibilities, capabilities, rules), default runtime and model, concurrency limit. Roles do not run. | Hired by the conductor, confirmed by the human. Zero or more per project. |
| **Worker** | A disposable agent spawned from a role for exactly one ticket: its own home, brief, worktree, and session for the life of the ticket. Retired once the work has landed. | firstmate's crewmate. One worker per ticket; many workers per role. |
| **Agent** | Anything that runs turns: the conductor or a worker. Has `id`, `kind` (`conductor` \| `worker`), `runtime`, `status`, home directory, session. | |
| **Runtime** | An adapter that runs an agent turn on a specific CLI (`claude`, `codex`, `opencode`, `gemini`) and normalizes its events, session handle, and usage. | Plugin interface §8. |
| **Session** | The runtime's conversation handle for an agent (e.g. a Claude Code session id). The conductor's is persistent; a worker's lasts the life of its ticket. | §7.4 |
| **Ticket** | The unit of work. Belongs to a workspace and optionally a project. Has a kind, status, an assigned role and (once spawned) its worker, blockers, comments, documents, work products, and (for `change` kind) a bound OpenSpec change. | Identifier `<PREFIX>-<n>` e.g. `ACME-42`. |
| **Wakeup** | A durable request to run one turn of an agent, with a source, reason and payload. Coalesced per agent. | §7.1 |
| **Run** | One executed agent turn: process invocation, events, usage, cost, result. | §7.3 |
| **Decision** | A question held for the human (or for the conductor) attached to a ticket: options, recommendation, answer. The one primitive for approvals, clarifications, and gate findings. | firstmate's "a decision is a task held for the captain". §15 |
| **Channel** | An adapter that connects a chat surface (web, CLI, Telegram, …) to the conductor, or to a live worker through its ticket thread. | §14 |
| **Thread** | A conversation between a human and an agent over a channel. The conductor has one primary thread per channel binding; tickets have their own comment threads. | |
| **Knowledge base** | Two curated, budgeted markdown bases: the workspace KB (conductor-owned; a project-agnostic `SHARED.md` subset is visible to workers) and one project KB per project (read and written concisely by that project's workers, never visible to other projects). Both are curated on a schedule so they stay small. | §13 |
| **Charter** | A role's generated instruction text: identity, responsibilities, rules, reporting contract. Rendered into every worker's `AGENTS.md` together with the ticket brief. | §11 |
| **Brief** | The per-worker task section: the ticket, its acceptance criteria, plan pointers, worktree, delivery mode, definition of done. | §11.2 |
| **Skill** | A `SKILL.md` package installed into an agent home, loaded on demand by the CLI. | §18 |
| **Hook** | An in-process or webhook subscriber to workspace events. | §17 |
| **Surface** | Where an agent is *shown* (and optionally attached to): headless, a web panel, a tmux window, a herdr pane, a Hyprland window on a chosen workspace. Surfaces never change how a run executes. | §14b |
| **Worktree** | A git worktree for one ticket branch, created at worker spawn by the worktree provider (worktrunk by default) and removed only when the work has landed. | §11.5 |

---

## 3. What we take from each inspiration

| Area | Source | Decision |
|---|---|---|
| Conductor role, hard rules, outcome-language, hiring loop, **one disposable worker per work item with a generated brief**, worktree-per-task with a landed-work teardown test, stuck-worker relaunch with the same brief, status vocabulary, decision-as-held-task, four-section briefing | firstmate | Adopt. See `docs/prompts/`. |
| Scripts-vs-judgment split, durable inbox + ack, two communication planes, restart-is-a-non-event | firstmate | Adopt, implemented as DB-backed wakeups/decisions instead of files. |
| Org model (roles, hierarchy conductor → roles → workers), tickets with statuses/blockers/checkout, run + run-event log, cost attribution fan-out, budget policies, adapter interface, skill-as-instruction-layer, `llms.txt`-style self-describing config, config revisions | paperclip | Adopt with a smaller schema (§6). |
| Liveness contract (every non-terminal ticket has an action path), status-as-ownership semantics, subtree-scoped write authority, courier pattern | paperclip | Adopt as state guards. |
| Durable wakeups as the only scheduling primitive, turn gate + `turn_epoch`, channel connector interface with capability degradation, reverse-MCP pull model, intercept ask/plan tools into cards, consume-once approvals, structured tool identity, machine-checked architecture guards | Synapse | Adopt. |
| Spec-driven ticket definition: `propose` → approve → `apply` → archive; CLI as state oracle; skills as agent prompts | OpenSpec | Integrate as-is (pinned version) with our own ticket↔change binding (§12). |
| Things to avoid (all four) | see research files | 200-line cap on always-loaded prompt; typed language for mechanics; one work model; one docs tree; no terminal scraping; enums as real constraints; telemetry off. |

---

## 4. Architecture

### 4.1 Process topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│  agent-conductor daemon  (one process per host, `conductor daemon`)               │
│                                                                          │
│   HTTP API (Hono)  ──  MCP endpoint per run  ──  SSE/WebSocket events    │
│   ┌────────────┐ ┌─────────────┐ ┌────────────┐ ┌──────────┐ ┌────────┐  │
│   │ wake queue │ │ run engine  │ │ ticket svc │ │ decision │ │ cost / │  │
│   │ + turn gate│ │ + supervisor│ │ + openspec │ │ + approv.│ │ usage  │  │
│   └────────────┘ └─────────────┘ └────────────┘ └──────────┘ └────────┘  │
│   ┌────────────┐ ┌─────────────┐ ┌────────────┐ ┌──────────┐             │
│   │ runtimes   │ │ channels    │ │ hooks/     │ │ knowledge│             │
│   │ (plugins)  │ │ (plugins)   │ │ webhooks   │ │ + memory │             │
│   └─────┬──────┘ └──────┬──────┘ └────────────┘ └──────────┘             │
│         │               │            SQLite (WAL) + workspace filesystem │
└─────────┼───────────────┼────────────────────────────────────────────────┘
          │               │
   spawns per turn   Telegram / web / CLI
   claude|codex|opencode|gemini  (cwd = agent home; a worker's home contains its worktree; --mcp-config → daemon)
```

- **The daemon is the only stateful process and can live on any host** (§4.4). Clients (web app, `conductor`, the presenter) hold no state beyond a login token and a cache.
- **One daemon per host hosts many workspaces.** The daemon keeps a registry (`~/.config/agent-conductor/workspaces.yaml`: id → root path) and opens one SQLite database per workspace. Every API path is workspace-scoped (`/api/w/<workspaceId>/...`); channels, budgets, runtimes' config homes and presentation surfaces are per workspace. The dispatcher, supervisor and event outbox run per workspace under one process with a shared global concurrency cap. The CLI (`conductor`), the web UI, channel adapters and agents talk to the daemon over HTTP (loopback by default, Unix socket optional); `conductor` resolves the workspace from `--workspace`, `AC_WORKSPACE`, or the nearest `workspace.yaml` above the cwd.
- **Agents (the conductor and workers) are child processes spawned per turn** by a runtime adapter, resuming that agent's session. A runtime adapter MAY keep a warm process between turns (streaming-input mode) but the contract is turn-based (§8).
- **Agents talk back** through an MCP server the daemon exposes per run (`/mcp/runs/<runId>`) authenticated by a run token, and optionally through the `conductor` CLI with the same token. The MCP/run endpoint listens on a **separate loopback-only listener** (or a Unix socket) on the daemon host; it is never exposed on the public listener. Nothing pushes into an agent mid-turn except the runtime's own input channel; new work arrives as the next wake.

### 4.2 Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, Node ≥ 22, ESM, strict | All four references and all four CLIs are Node; fastest path for the implementer. |
| Monorepo | pnpm workspaces + turbo | Standard. |
| HTTP | Hono | Small, typed, runs on Node; easy to embed an MCP transport. Two listeners: public (auth required, TLS-terminated by the daemon or a proxy) and loopback/socket (run tokens, presenter on the same host). |
| MCP | `@modelcontextprotocol/sdk` (Streamable HTTP) | All four CLIs support MCP over HTTP. |
| DB | SQLite via Node's built-in `node:sqlite` with hand-written SQL migrations (ADR 0001); WAL mode; one file per workspace at `.agent-conductor/db.sqlite` | Local-first, zero-config, no native build, single writer (the daemon). Postgres is out of scope for v1. |
| Validation | Zod, single source of truth; JSON Schemas generated for config files (draft-07) with a CI drift check | Synapse pattern. |
| Process control | `child_process.spawn` with `detached: true` process groups, kill by group | Needed to reap CLI subprocess trees. |
| Logging | pino, closed `domain` enum, `trace_id` in body | Synapse pattern; guard script bans bare `console.*` in `packages/*/src`. |
| Tests | vitest; contract tests per plugin interface; a fake runtime for engine tests | |
| UI | React + Vite, served by the daemon; SSE for live updates | Minimal in v1 (§21). |
| Config files | YAML with `${ENV_VAR}` indirection for secrets; literal secrets rejected | Synapse pattern. |
| Auth | Argon2id password hashes, opaque session tokens (httpOnly cookie for web, bearer for CLI), optional TOTP, WebAuthn passkeys later | Single-operator, many devices. |
| TLS | Built-in ACME (Let's Encrypt via HTTP-01/TLS-ALPN) or self-signed with pinning for LAN; or a reverse proxy / Tailscale Serve | Operator's choice; plaintext only on loopback. |

### 4.3 Monorepo layout

```
agent-conductor/
  package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
  packages/
    shared/        # types, Zod schemas, enums (const object + tuple), constants, event names, error codes
    core/          # domain services: workspace, project, agent, ticket, decision, wake queue, run engine,
                   # supervisor, knowledge, usage, openspec adapter, hooks bus. No HTTP, no CLI.
    db/            # Drizzle schema + migrations + repo layer (camelCase records, snake_case columns)
    server/        # Hono app: REST routes, MCP endpoint, SSE, auth, static UI; wires core + plugins
    cli/           # `conductor` binary: human commands + agent commands (uses the HTTP API, never the DB)
    runtime-sdk/   # RuntimeAdapter interface, event normalizer helpers, process utilities, test kit
    runtimes/
      claude/  codex/  opencode/  gemini/
    channel-sdk/   # ChannelAdapter interface, CanonicalMessage, degradation, test kit
    channels/
      web/  cli/  telegram/
    surface-sdk/   # SurfaceAdapter interface (§14b) + test kit
    surfaces/
      headless/  tmux/  herdr/  hyprland/
    tui/           # Ink-based terminal apps: `conductor chat`, `conductor attach`, `conductor top`
    plugin-sdk/    # createPlugin(host) contract: register runtimes/channels/hooks/tools/surfaces/storage
    ui/            # React web app (§21)
  skills/          # SKILL.md packages shipped to agents (§18); copied into agent homes by the daemon
  templates/       # charter templates, workspace scaffold, openspec config snippets
  docs/            # this plan, research, ADRs (docs/adr/NNNN-*.md), prompts
```

Rules enforced by scripts in CI (`scripts/guard-*.mjs`):
- `core` MUST NOT import `server`, `cli`, or any runtime/channel package (dependency direction: shared ← db ← core ← server/cli; plugins depend on the SDKs only).
- No raw string literals for business enums in branches; use the exported const objects.
- No bare `console.*` outside `cli`.
- Every mutating REST route writes an `activity` row (checked by a route-metadata test).
- Generated JSON Schemas match Zod (drift check).

### 4.4 Deployment topologies and remote access

The daemon host is where code runs: it holds the workspace directories, the coding CLIs and their auth, git/SSH/`gh` credentials, channel bots, and the runtime config homes. Everything else is a client.

| Topology | How it is reached | Auth | TLS |
|---|---|---|---|
| **Local** (daemon on the machine you sit at) | `http://127.0.0.1:<port>` | password still required by default; `auth.loopbackTrusted: true` opts out for loopback only | none needed |
| **LAN / Tailscale** | `https://conductor.tailnet.ts.net` or `https://conductor.lan` | password (+ optional TOTP) | Tailscale Serve, or self-signed cert with `conductor login --pin` |
| **Public server** (VPS, home server with a port forward) | `https://conductor.example.com` | password + TOTP recommended; lockout and rate limiting on | built-in ACME, or Caddy/nginx in front (`conductor daemon install-service` prints both variants) |

Rules:
- The public listener **never** starts without a configured operator password, except when bound to loopback with `loopbackTrusted`. `conductor init` sets the password (or `conductor daemon set-password`).
- Every request outside loopback is authenticated (session cookie for the web app, bearer token for `conductor`, per-channel bot auth for Telegram, HMAC for webhooks). The run-token MCP endpoint and the same-host presenter socket live on the loopback listener only.
- One operator account per daemon in v1 (many devices, many sessions, each revocable from Settings → Devices). Multi-user, roles and per-workspace permissions are a later feature and the auth model must not preclude them (tokens already carry a principal id).
- Session tokens: opaque, hashed at rest, 30-day sliding expiry for devices the operator names, 12 h for unnamed browser sessions; `conductor logout --all` and Settings revoke. Login attempts are rate-limited and logged in `activity`; five failures lock the account for 15 minutes.
- TLS: the daemon can terminate TLS itself (ACME with HTTP-01 on port 80/443, or TLS-ALPN) or run behind a proxy that sets `X-Forwarded-*` (only trusted when `http.trustProxy` is set). `conductor login` refuses plaintext to non-loopback hosts unless `--insecure` is given.
- The web app is served by the daemon and works as an installable PWA remotely (push notifications through the web channel, service worker caching of the shell, offline read of the last state, queued composer messages sent on reconnect).
- `conductor` is a pure remote client: `conductor login https://conductor.example.com` stores a named context in `~/.config/agent-conductor/contexts.yaml` (URL, token, default workspace, cert pin); `conductor context use <name>`; every command works identically against a local or remote daemon. `conductor attach`, `conductor chat`, `conductor top` stream over WebSocket/SSE with reconnect.
- **Presentation surfaces run on the client** (§14b): `conductor presenter` is a small local process that subscribes to the daemon's event stream and manages terminal windows (Hyprland, herdr, tmux) on the machine it runs on, each window running `conductor attach <worker>` against the remote daemon. The daemon holds only the desired presentation config; the presenter reconciles it locally. On the daemon host itself the presenter is optional.
- Voice dictation works remotely: the browser's Web Speech API when available, else the composer streams audio to `POST /api/w/<ws>/transcribe`, which delegates to a configured transcription provider on the daemon host (pluggable; `none` by default with a clear UI message).
- What must be set up on the daemon host and nowhere else: coding-CLI logins (`conductor runtime login <id>` walks the device-code/OAuth flows in the per-workspace config homes), git credentials/SSH keys and `gh auth`, secrets referenced from `workspace.yaml`, channel bot tokens, worktrunk. `conductor doctor [--install] [--yes]` verifies all of them and prints what is missing.
- Packaging: `conductor daemon install-service` writes a systemd user or system unit (Linux) and a launchd plist (macOS); a Docker image with a volume for `/data` (workspaces, config homes) is provided for servers. Backups are the workspace directories plus `~/.config/agent-conductor`.

---

## 5. Workspace filesystem layout

A workspace is a directory. `conductor init <dir> --prefix ACME` scaffolds it.

```
<workspace>/
  workspace.yaml              # identity, projects, channels, plugins, defaults, presentation
  .agent-conductor/             # runtime state (gitignored if the workspace is itself versioned)
    db.sqlite                 # canonical state: tickets, runs, wakeups, decisions, costs, events
    runs/<runId>/             # stdout/stderr logs, raw event stream (jsonl), mcp config, prompt file
    sessions/                 # runtime-specific session artifacts when a runtime needs a stable place
    daemon.lock  daemon.sock  daemon.log
  conductor/                  # conductor home (cwd of the conductor's runtime session)
    AGENTS.md                 # conductor system prompt (generated from template; human-editable overrides in conductor/OVERRIDES.md)
    CLAUDE.md -> @AGENTS.md   # per-runtime pointers (see §8.3 for each CLI's discovery file)
    .claude/skills/ .agents/skills/ .opencode/skills/   # skills installed by the daemon
  knowledge/                  # the knowledge bases (§13); git-friendly markdown, all budgeted and curated
    workspace/
      WORKSPACE.md            # conductor-only: what this business is, goals, people, the project portfolio, how the human works
      SHARED.md               # project-agnostic subset every agent sees: conventions, glossary, house rules (never names other projects)
      decisions.md            # durable decision log (appended by the daemon from answered decisions); archived by curation
      archive/                # pruned entries with provenance; never injected
    projects/<projectId>/
      PROJECT.md              # the project KB: overview, stack, commands, conventions, focus, landmines, learnings (workers read + write)
      archive/                # pruned entries with provenance; never injected
  roles/<roleId>/             # hired role (template); nothing runs here
    role.yaml                 # spec: project, charter fields, runtime, model, maxWorkers, policies
    CHARTER.md                # charter text (generated by the conductor, revisioned; human overrides in OVERRIDES.md)
  workers/<workerId>/         # worker home = cwd for every turn of that worker; disposable
    AGENTS.md                 # rendered: role charter + ticket brief; CLAUDE.md / GEMINI.md are pointers
    brief.md                  # the brief alone (for humans and for relaunch)
    .claude/skills/ ... .opencode/skills/  # skills installed by the daemon for this runtime
    work/                     # the ticket worktree (worktree provider places it here)
    notes.md                  # worker scratch, not injected anywhere, archived with the worker
  projects/<projectId>/       # primary git clone (reference only; the daemon fast-forwards it, nobody works here)
  archive/workers/<workerId>/ # retired workers' brief, notes, final report (logs stay under .agent-conductor/runs)
  tickets/                    # optional rendered markdown mirror of tickets (generated, read-only)
```

Rules:
- `projects/<id>` MUST be kept on the default branch and only fast-forwarded by the daemon (`git fetch` + `git merge --ff-only`). No agent's cwd points here.
- Each agent's cwd is its **home**: `conductor/` for the conductor, `workers/<id>/` for a worker. The worker's worktree is `workers/<id>/work/`, so the CLI's file tools reach it without extra flags and the charter+brief at cwd is discovered natively by every CLI (§8.3). cwd never changes during a worker's life, so sessions resume cleanly (Claude Code keys transcripts by cwd; Codex/OpenCode/Gemini read instructions from cwd).
- Roles are templates only; a role directory is never a cwd.
- `workspace.yaml` is the declared configuration; the DB is the runtime state. On daemon start the daemon reconciles: declared projects are cloned if missing, declared agents are created if missing, DB rows without declarations are flagged (not deleted).

`workspace.yaml` (Zod-validated; JSON Schema generated):

```yaml
version: 1
id: acme                      # slug
name: Acme Labs
ticketPrefix: ACME
defaults:
  runtime: claude             # default runtime for new projects
  model: null                 # runtime-specific model id or null = runtime default
  proposalApproval: human     # human | conductor | none  (who approves OpenSpec proposals)
  autoMerge: false            # default for new tickets; per-ticket flag; the conductor may create tickets with it on when told to
  deliveryMode: pr            # pr | local-branch  (how workers deliver)
projects:
  - id: api
    url: git@github.com:acme/api.git
    defaultBranch: main
    runtime: codex            # default runtime for roles hired into this project
    maxWorkers: 4             # concurrent workers across all roles in this project
    setupCommand: pnpm install   # run once per new worktree (worktrunk post-create hook)
    worktrees: worktrunk      # worktrunk | git  (worktree provider, §11.5)
    openspec: { enabled: true }
    policies: { proposalApproval: conductor }
conductor:
  runtime: claude
  model: claude-fable-5-1     # chosen from the runtime's listModels(); null = runtime default
  channels: [web, cli, telegram]
presentation:                 # §14b; all optional, default headless + web
  default: headless
  conductor: { surface: terminal }          # the human chats in a terminal; web still works
  workers: { surface: hyprland, workspace: 5, layout: grid }   # terminal: system default ($TERMINAL); override with terminal: <cmd>
  # or: workers: { surface: herdr, workspace: "acme", tabPerProject: true }
  # or: workers: { surface: tmux, session: ac-acme }
channels:
  telegram:
    botToken: ${TELEGRAM_BOT_TOKEN}
    allowedUserIds: [12345678]
plugins:
  - "@acme/ac-runtime-aider"        # npm package or ./relative/path
  - ./plugins/jira-sync
```

Daemon-level settings (listen addresses, TLS, auth, ACME, trusted proxy, transcription provider) live in `~/.config/agent-conductor/daemon.yaml`, not in any workspace; secrets there are also env references.

Roles are NOT normally listed in `workspace.yaml`; they are hired at runtime and live in `roles/<id>/role.yaml` (which the daemon writes). Workers are pure runtime state. A workspace can be exported/imported as a directory (§20).

---

## 6. Domain model

All tables carry `workspace_id`. Timestamps are ISO-8601 UTC text. Ids are ULIDs (sortable). Enums are SQLite `CHECK (col IN (...))` constraints generated from the shared const tuples (paperclip's enum-as-text is the cautionary tale). Column names snake_case; TypeScript records camelCase (Drizzle mapping).

### 6.1 Entities

**workspaces** — `id, slug, name, ticket_prefix, ticket_counter, status (active|paused|archived), root_path, created_at, updated_at, settings_json`.

**projects** — `id, workspace_id, slug, name, git_url, default_branch, clone_path, max_workers (default 4), setup_command (run once per new worktree, e.g. `pnpm install`), worktree_provider (worktrunk|git), runtime_id, model, openspec_enabled, openspec_version (pinned), policies_json {proposalApproval, mergeMethod (squash|merge|rebase), deliveryMode, autoMergeDefault}, status (cloning|ready|error|archived), last_fetched_at, error_text`.

**roles** — `id, workspace_id, project_id, slug, name (e.g. "Backend Engineer"), title, icon, charter_summary (one sentence; used in routing), scope_text (natural-language routing scope; exclusions explicit), responsibilities_json, capabilities_json, rules_json, runtime_id, model, effort, permission_json, session_policy (per_ticket|fresh, default per_ticket), max_workers (default 2), secrets_json, status (pending_activation|active|paused|retired), pause_reason, spec_revision, memory_budget_tokens, created_by (human|conductor), created_at, updated_at`.

**role_revisions** — `id, role_id, revision, changed_keys_json, before_json, after_json, author (human|conductor|system), reason, created_at`. Every change to `role.yaml` or the charter writes one; rollback supported. Running workers keep the revision they were spawned with; a running worker's next turn prompt notes "your role's charter changed" only for rules marked `applyToRunning`.

**agents** — everything that runs turns: `id, workspace_id, kind (conductor|worker), project_id (null for conductor), role_id (workers), role_revision, ticket_id (workers; always set), name (e.g. "Backend Engineer #7"), runtime_id, model, effort, status (provisioning|active|running|paused|error|done|retired), pause_reason, error_text, home_path, worktree_path, branch, turn_epoch, turn_count, spawned_by (conductor|human|system), spawn_reason, brief_revision, last_run_at, retired_at, created_at, updated_at`. Exactly one `kind=conductor` per workspace. Unique `(ticket_id)` among non-retired workers (one worker per ticket).

**agent_sessions** — `id, agent_id, runtime_id, session_ref_json (opaque runtime handle), display_id, status (active|stale|closed), turn_count, last_run_id, last_error, cumulative_usage_json, created_at, updated_at`. One active session per agent.

**worktrees** — `id, project_id, ticket_id, agent_id, provider, path, branch, status (active|dirty|landed|removed|orphaned), created_at, last_verified_at, removed_at, landed_evidence_json`. Mirror of the provider's state (`wt list --json` / `git worktree list --porcelain`) plus our landed-work verdict.

**tickets** — `id, workspace_id, project_id (nullable: workspace-level tickets belong to the conductor), number, identifier (PREFIX-n), kind (change|task|scout|question), title, description (markdown), status (see 6.2), priority (critical|high|medium|low), auto_merge (bool, default false), assignee_role_id, worker_id (the live worker; null until spawned or after retirement), assignee_human (bool), parent_id (structure only), created_by_kind (human|conductor|agent|system|routine), created_by_id, origin_kind, origin_fingerprint, checkout_run_id, execution_run_id, execution_locked_at, openspec_change_name (nullable), openspec_state_json (last observed: planningComplete, tasks {total, complete}, archived), delivery_json {branch, prUrl, prState}, unblock_json {owner, action} (nullable), monitor_next_check_at, blocked_transition_at, started_at, completed_at, cancelled_at, created_at, updated_at`.
Constraints: assignee is role XOR human XOR null; `worker_id` implies `assignee_role_id`. Unique `(workspace_id, number)`. Partial unique on `(workspace_id, origin_kind, origin_fingerprint)` while status not terminal (routine dedupe).

**ticket_relations** — `ticket_id, related_ticket_id, kind (blocks)`; cycles rejected; cancelled blockers do not satisfy dependencies.

**ticket_comments** — `id, ticket_id, author_kind (human|agent|system), author_id, run_id, body (markdown), kind (comment|status|report|relay), source_trust (trusted|agent|external), created_at, edited_at, deleted_at`.

**ticket_documents** — `id, ticket_id, key (plan|report|spec-summary|…), current_revision`; **ticket_document_revisions** — `id, document_id, revision, body, author_kind, author_id, run_id, created_at`. Plans and scout reports are revisioned documents, not comments.

**ticket_work_products** — `id, ticket_id, run_id, type (pull_request|branch|commit|artifact|preview_url|report), provider, external_id, url, title, state, is_primary, metadata_json, created_at, updated_at`.

**decisions** — `id, workspace_id, ticket_id (nullable for workspace-level), kind (approval|question|gate_finding|plan_approval|hire_approval|merge_approval|discard_approval), owner (human|conductor), asked_by_agent_id, asked_in_run_id, title, context (markdown), options_json ([{key,label,description,recommended}]), allow_free_text, recommendation, status (open|answered|expired|withdrawn|superseded), answer_key, answer_text (verbatim words of the answerer), answered_by_kind, answered_by_id, answered_at, expires_at, target_json (e.g. {documentId, revision} so a newer plan revision supersedes the pending approval), correlation_key, created_at`.
Rule: one open decision per `(ticket_id, correlation_key)`. Answering a decision enqueues a wake for `asked_by_agent_id` with `source=decision_answered`.

**wakeups** — `id, workspace_id, agent_id, source (human_message|ticket_assigned|ticket_comment|mention|decision_answered|blockers_resolved|children_completed|timer|routine|system|retry|conductor_request), reason (short text), payload_json, idempotency_key, status (queued|claimed|coalesced|skipped|completed|failed|cancelled), coalesced_into_id, skip_reason, run_id, requested_by_kind, requested_by_id, created_at, claimed_at, finished_at, not_before`. Unique `(agent_id, idempotency_key)` where not null.

**runs** — `id, workspace_id, agent_id, ticket_id (nullable FK, real column), session_id, wakeup_ids_json, runtime_id, model, status (queued|running|succeeded|failed|timed_out|cancelled|interrupted), turn_epoch, cwd, started_at, finished_at, exit_code, signal, pid, pgid, error_code, error_family (transient_upstream|provider_quota|model_refusal|auth|tooling|unknown), retry_of_run_id, scheduled_retry_at, usage_json {inputTokens, outputTokens, cachedInputTokens, usageBasis}, cost_cents, result_json (structured final report, §9.4), liveness (advanced|plan_only|empty|blocked|needs_decision|failed), log_path, prompt_path, summary`.

**run_events** — `id, run_id, seq (unique per run), ts, type (closed enum, §16.1), stream (stdout|stderr|runtime|system), level, payload_json (redacted, size-bounded), source_event_id`. Raw untruncated stream goes to `.agent-conductor/runs/<id>/events.jsonl`.

**usage_events** — `id, workspace_id, project_id, role_id, agent_id, ticket_id, run_id, runtime_id, provider, model, billing_type (metered_api|subscription_included|unknown), input_tokens, cached_input_tokens, output_tokens, cost_cents (nullable), cost_status (reported|estimated|unpriced), duration_ms, occurred_at`. One row per run (or per usage delta for cumulative-session runtimes). Indexed on `(workspace_id, occurred_at)`, `(project_id, occurred_at)`, `(ticket_id)`, `(model, occurred_at)` so the analytics windows (§16.3) are cheap.

**channels** — `id, workspace_id, kind (web|cli|telegram|…), config_json (secrets by env ref), status, last_error`. **channel_threads** — `id, channel_id, agent_id (the conductor), ticket_id (set when the thread is bound to a ticket; messages then land as ticket comments and wake that ticket's worker), external_thread_id, external_user_id, human_label, created_at, last_message_at`. **thread_messages** — `id, thread_id, direction (inbound|outbound), author_kind, author_id, run_id, body, parts_json (CanonicalMessage), external_message_id, delivery_status, created_at`.

**operator** — `id, username, password_hash (argon2id), totp_secret_enc (nullable), created_at, updated_at`. One row in v1.

**auth_sessions** — `id, operator_id, token_hash, kind (web|cli|presenter), device_name, created_at, last_seen_at, expires_at, revoked_at, ip, user_agent`.

**login_attempts** — `id, username, ip, ok, created_at` (for rate limiting and lockout).

**activity** — `id, workspace_id, actor_kind (human|agent|system), actor_id, run_id, action (closed enum), entity_type, entity_id, ticket_id, details_json, created_at`. Written by every mutation.

**events** — the outbox: `id, seq, workspace_id, type (closed enum), entity_type, entity_id, payload_json, created_at, delivered_hooks_json`. Every domain change appends here; hooks/SSE/webhooks consume from `seq`.

**routines** — `id, workspace_id, name, trigger_json ({kind: schedule, cron} | {kind: webhook, publicId, signing}), template_json (ticket template), agent_id, concurrency (coalesce_if_active|skip_if_active|always), status, last_fired_at`. v1 ships the schema and cron trigger only; webhooks in M6.

**spec_capabilities**, **spec_requirements**, **spec_changes**, **spec_change_capabilities**, **knowledge_search** (FTS5) — the spec index, §12.5.

**knowledge_files** — `id, workspace_id, project_id (nullable), path, scope (workspace|shared|decisions|project), token_estimate, budget_tokens, last_curated_at, curation_pending (bool), hash, updated_at`; **knowledge_revisions** — `id, file_id, revision, body, author_kind, author_id, run_id, reason (note|curation|human|expiry), removed_entries_json, created_at`. Every write is a revision; curation removals are archived with provenance.

**secrets** — `id, workspace_id, name, env_var_name, scope (workspace|project|role), scope_id`. Values are never stored in the DB; only references to env vars or an OS keychain entry. Runs receive secrets as env only when the agent's spec lists them.

### 6.2 Ticket state machine

Kinds: `change` (code change through OpenSpec), `task` (work without a spec; chores, docs, ops; OpenSpec `skip_specs`), `scout` (investigation; deliverable is a `report` document, never code), `question` (answered in comments; no code).

Statuses and meaning (each status states who owns the next move):

| Status | Owner of next move | Entry condition |
|---|---|---|
| `backlog` | conductor/human (triage) | created without assignment |
| `todo` | worker | assigned to a role, ready to start; the daemon spawns the worker, or the ticket waits with a visible reason when `max_workers` is reached |
| `proposing` | worker | `change` kind: the worker is writing OpenSpec planning artifacts |
| `proposed` | approver per policy | OpenSpec `isPlanningComplete` and `validate` pass; a `plan_approval` decision is open |
| `approved` | worker | plan approval answered `approve`; the worker may implement |
| `in_progress` | worker | execution-backed: a run is active or a wake is queued for the worker (liveness rule) |
| `in_review` | human | work product exists (PR or branch); a `merge_approval` decision owned by the human is open, unless `auto_merge` is set |
| `merging` | worker | the human approved the merge, or `auto_merge` is on and CI is green; the same worker syncs with the default branch, resolves conflicts, re-runs checks, and merges |
| `blocked` | named owner | MUST have a routable path: open blockers, an open decision, or `unblock_json {owner, action}`; prose-only blocked is rejected |
| `done` | nobody | terminal; for `change`: merge landed (verified by reconciliation), OpenSpec change archived on the default branch, worktree removed, worker retired |
| `cancelled` | nobody | terminal |

Transitions are validated in `core/tickets/transitions.ts` (single owner). Agents request transitions through the MCP tool `ac_ticket_transition`; the daemon applies guards and returns the resulting state or a typed error (`invalid_disposition`, `missing_action_path`, `not_checked_out`). The full flow for `change` tickets is in §12.

**Liveness rule (enforced, not narrated):** a ticket in `todo|proposing|approved|in_progress|merging` MUST have at least one of: a live worker with an active run or a queued wake, a pending spawn (waiting for a worker slot), an open decision, a scheduled `monitor_next_check_at`, or a human assignee. The supervisor scans every 60 s; violations produce a `system` wake for the worker (reason `liveness_repair`) or a spawn attempt, then after two failures a `gate_finding` decision for the conductor.

**Checkout:** a worker is bound to its ticket at spawn (the daemon performs the checkout); a run MUST still call `ac_ticket_checkout` before writing (idempotent for the bound worker, `409` for anyone else, never retried). `checkout_run_id` = ownership; `execution_run_id` = live run. Compare-and-clear on run finalization. Subtree-scoped authority: a run may mutate its ticket and that ticket's descendants; anything else is `403`.

### 6.3 Agent state machine

**Role:** `pending_activation` (hired, waiting for the human to confirm/switch runtime) → `active` → `paused` (by the human; no new workers spawn, live workers finish their turn and then wait) → `retired` (no live workers allowed; requires a human decision if any exist).

**Worker:** `provisioning` (home rendered, worktree created, skills installed, session placeholder) → `active` (idle, waiting for wakes) ⇄ `running` ; `paused` ; `error` (last run failed non-transiently; supervisor asks the conductor) → `done` (ticket terminal, work landed) → `retired` (worktree removed, home archived). A failed or cancelled ticket leaves its worker in `done` with a `dirty` worktree until discarded.

**Conductor:** `active` ⇄ `running` ; `paused`.

---

## 7. Wake and run engine

### 7.1 Wake queue

`enqueueWakeup(agentId, {source, reason, payload, idempotencyKey?, notBefore?, requestedBy})` is the single funnel. Ordered gates (each skip writes a `skipped` row with `skip_reason`):

1. Agent exists and workspace is `active`.
2. Agent status: `paused|retired|done` → skip (`agent_paused` / `agent_retired`); a worker whose role is `paused` → skip (`role_paused`).
3. Coalesce: if the agent has a `queued` wake, merge payloads (append) into it (`coalesced`); if it has a `running` run, queue normally (the turn gate serializes).
4. Insert `queued`.

Wake sources and who enqueues them:

| Source | Enqueued when |
|---|---|
| `human_message` | a channel thread message arrives for the agent (conductor or direct chat) |
| `ticket_assigned` | a worker is spawned for a ticket, or its ticket is set to `approved|merging` |
| `ticket_comment` / `mention` | comment on the worker's ticket / @mention of the conductor or a worker |
| `decision_answered` | a decision the agent asked is answered |
| `blockers_resolved` / `children_completed` | all blockers `done` / all children terminal |
| `conductor_request` | the conductor calls `ac_worker_message` (steering a live worker on its ticket) |
| `timer` | conductor heartbeat (`conductor.heartbeatIntervalSec`, default off); workers have no timers |
| `routine` | routine fired |
| `system` | supervisor: liveness repair, stuck escalation, reconciliation |
| `retry` | previous run failed with a transient family |

### 7.2 Turn gate and dispatcher

- One run at a time per agent (one session ⇒ strictly serial per worker; workers of the same role run in parallel up to `role.max_workers` and `project.max_workers`). The dispatcher claims the oldest `queued` wake for each idle agent, bundles every other queued wake for that agent into the same run (`wakeup_ids_json`), and starts a run with a fresh `turn_epoch = agent.turn_epoch + 1`.
- Caps: `daemon.maxConcurrentRuns` (default 6 per host), `project.max_workers`, `role.max_workers`. A ticket assigned to a role with no free worker slot waits in `todo` with a visible reason; the conductor is told when the wait exceeds `spawnWaitWarnSec` (default 10 min).
- The dispatcher is a 1 s tick reading the DB; no in-memory queue is authoritative. Restart-safe: on boot, runs in `running` whose pid is dead are marked `interrupted` and their wakes are re-queued (`retry`, one attempt).

### 7.3 Run lifecycle

```
queued → running → (succeeded | failed | timed_out | cancelled | interrupted)
```

Steps (module `core/runs/engine.ts`, each step emits `run.phase.timing` with a closed phase allowlist: `prepare_home, prepare_worktree, build_prompt, spawn, turn, collect_result, finalize`):

1. **Prepare home**: ensure skills are installed for the agent's runtime and the home's `AGENTS.md` is current (conductor: regenerate on template change; worker: rendered once at spawn, re-rendered only on relaunch or brief revision).
2. **Prepare worktree** (workers): verify the worktree still exists at `work/` and `git fetch origin` there. The engine never resets, cleans or switches branches in a worker's worktree.
3. **Build the turn prompt** (§9.3): wake digest (which tickets/messages/decisions), deltas since last turn, explicit instructions for what to do now. Written to `.agent-conductor/runs/<id>/prompt.md` and passed to the runtime.
4. **Mint run token** (JWT, 2 h, claims: workspace, agent, run, ticket scope) and write the MCP config file pointing to `http://127.0.0.1:<port>/mcp/runs/<runId>` with the token.
5. **Spawn via runtime adapter** (`runtime.runTurn`), streaming events into `run_events` (redacted) and the raw jsonl. Update `agent.status=running`, `execution_run_id` on the worker's ticket.
6. **Supervise** (§7.5): silence watchdog, hard timeout (`agent.spec.turnTimeoutSec`, default 45 min).
7. **Collect result**: runtime returns `{sessionRef, usage, cost, exitCode, finalMessage, structuredResult?}`. The engine parses the agent's final report (§9.4). If missing, liveness = `empty`.
8. **Finalize** (transaction): persist run, usage event, session ref; compare-and-clear `execution_run_id`; mark wakes `completed`; apply liveness classification; enqueue follow-up wakes (e.g. `needs_decision` → decision created → owner notified); emit events; if `error_family=transient_upstream|provider_quota` schedule a `retry` wake with backoff (30 s, 2 min, 10 min; max 3).

### 7.4 Sessions and context economy

- **Conductor: one persistent session**, resumed every turn; the CLI's own compaction manages growth. `conductor conductor reset-session` starts a new one (old ref kept for audit); the next turn gets a bootstrap digest (§13.3).
- **Worker: one session for the life of its ticket** (`role.session_policy=per_ticket`, the default). The first turn injects charter + brief; every later wake (approval answered, comment, steering, merge approved, relaunch) resumes the same session, so the worker remembers its own proposal and implementation without re-reading. Nothing is re-injected on resumed turns (5–10k tokens saved per turn, paperclip's finding); a changed brief is delivered as a short "brief updated" note in the turn prompt.
- **`fresh`** (no resume) exists for stateless roles such as a reviewer whose deliverable is one report.
- **Cross-ticket familiarity does not live in sessions.** It lives in the project KB (`PROJECT.md`: concise, budgeted, written by workers, curated on a schedule), the repo's own instructions and OpenSpec specs, and the ticket's documents. A new worker bootstraps from those (§13.3) in a bounded digest. This is cheaper and more reliable than dragging a long conversation along, and it is what makes N concurrent workers possible.
- **Relaunch, not respawn.** A stuck or crashed worker is relaunched into the same home and worktree, resuming the same session where the runtime allows it, with the same brief plus a progress note the engine derives from the ticket (last status, tasks ticked, dirty files, last commit). Only when the session itself is corrupt does the engine start a new session for the same worker, with the bootstrap digest.
- Session staleness applies to the conductor only (`sessionMaxIdleDays`, default 14) and triggers a bootstrap digest on the next turn.

### 7.5 Supervision

The supervisor is daemon code (zero LLM tokens), running every 15 s:

- **Silence watchdog**: no run events for `silenceTimeoutSec` (default 10 min) while the worktree has no file newer than the silence window → mark `stuck`, send SIGINT, wait 30 s, SIGKILL the process group; run `failed(error_family=tooling)`; requeue once as `retry`. Worktree write activity defers escalation (firstmate's write-evidence rule).
- **Hard timeout** per turn.
- **Liveness scan** (60 s): §6.2 rule.
- **Decision expiry**: decisions past `expires_at` → `expired`, owner notified, ticket set to `blocked` with `unblock_json`.
- **Reconciliation** (hourly): for each project, `git fetch`; for each ticket with a PR work product, refresh PR state via `gh` (if available) → `merged` closes `in_review` tickets per policy; for each `change` ticket, re-read OpenSpec state (§12.4) and repair drift (e.g. archived on disk but ticket not `done`).
- **Worker spawn and retirement**: spawn workers for `todo` tickets whose role has a free slot; retire workers whose ticket is terminal and whose worktree passes the landed-work test (§11.5); relaunch stuck workers per the ladder in §11.6.
- **Heartbeat digest for the conductor**: if anything changed that is conductor-relevant (ticket done/blocked/needs decision, worker error or stuck, spawn waits), enqueue a `system` wake for the conductor with reason `digest` — coalesced, at most once per `conductorDigestIntervalSec` (default 120 s) while the human is not actively chatting.

### Implementation notes

Modules: `core/wakeups/{queue,gates}.ts`, `core/runs/{engine,dispatcher,supervisor,finalize}.ts`, `core/sessions/policy.ts`. Tests: fake runtime adapter that scripts events/results; property tests for the turn gate (never two concurrent runs per agent, never lost wakes across simulated crashes); golden tests for prompt building.

---

## 8. Runtime adapters

### 8.1 Interface (`packages/runtime-sdk`)

```ts
export interface RuntimeAdapter {
  readonly id: string;                       // "claude" | "codex" | "opencode" | "gemini" | plugin ids
  readonly displayName: string;
  readonly capabilities: RuntimeCapabilities;
  detect(): Promise<RuntimeDetection>;       // { status: available|missing_binary|broken|unsupported, version?, path?, notes? }
  listModels(): Promise<RuntimeModel[]>;    // { id, label, provider, source: detected | static, tier?, notes? } — feeds the model dropdown for every agent incl. the conductor
  configSchema(): JsonSchema;                // per-agent runtime options (model, effort, permission mode, extraArgs)
  installInstructions(home: AgentHome, bundle: InstructionBundle): Promise<void>;
                                             // materialize AGENTS.md pointer files + skills into the home for THIS cli
  runTurn(input: TurnInput, sink: TurnSink): Promise<TurnResult>;
  cancel(handle: TurnHandle, mode: "interrupt" | "kill"): Promise<void>;
  forkSession?(base: SessionRef): Promise<SessionRef>;
  describeSession?(ref: SessionRef): Promise<{ displayId: string; exists: boolean }>;
}

export interface RuntimeCapabilities {
  resumableSessions: boolean;               // all four: true
  forkSessions: boolean;
  streamingInput: boolean;                  // can keep a warm process (claude stream-json input, opencode serve, codex app-server)
  systemPromptInjection: "system_prompt" | "append" | "file_only" | "none";
  structuredOutput: boolean;               // json-schema constrained final message
  mcp: boolean;
  usageReporting: "per_turn" | "session_cumulative" | "none";
  costReporting: boolean;
  permissionModes: string[];
}

export interface TurnInput {
  runId: string; turnEpoch: number;
  cwd: string;                              // = agent home (charter+brief at root, skills, work/ worktree for workers)
  worktree: { path: string; branch: string } | null;
  session: { policy: "persistent" | "per_ticket" | "fresh"; ref: SessionRef | null; isFirstTurn: boolean };
  systemPrompt: { text: string; mode: "inject" | "skip" };   // inject only on first turn / after reset
  prompt: string;                           // the turn prompt (wake digest)
  outputSchema?: JsonSchema;                // final structured report
  mcpServers: Record<string, McpServerConfig>;  // includes the agent-conductor run endpoint
  env: Record<string, string>;              // AC_* vars + agent secrets
  options: Record<string, unknown>;         // validated against configSchema()
  limits: { timeoutMs: number; maxBudgetUsd?: number; maxTurns?: number };
  permission: { mode: "auto" | "restricted" | "bypass"; allowedTools?: string[]; deniedTools?: string[] };
}

export interface TurnSink {
  onSpawn(info: { pid: number; pgid: number | null }): void;
  onEvent(ev: RuntimeEvent): void;          // normalized (§8.2)
  onRaw(stream: "stdout" | "stderr", chunk: string): void;
}

export interface TurnResult {
  exitCode: number | null; signal: string | null; timedOut: boolean;
  session: SessionRef | null;               // updated handle to persist
  finalText: string | null;
  structured?: unknown;                     // parsed against outputSchema when supported
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; basis: "per_turn" | "session_cumulative" };
  cost?: { usd: number; status: "reported" | "estimated" };
  model?: string; provider?: string;
  error?: { code: string; family: RunErrorFamily; message: string; retryAfterMs?: number };
}
```

`SessionRef` is opaque JSON owned by the adapter (`{ sessionId }` for Claude/Gemini, `{ threadId }` for Codex, `{ sessionId, serverUrl? }` for OpenCode).

### 8.2 Normalized runtime events

Closed enum (`shared/src/run-events.ts`): `session.started, session.resumed, turn.started, assistant.text, assistant.thinking (redacted to length), tool.call, tool.result, tool.denied, permission.requested, user_input.requested, plan.proposed, file.changed, command.executed, usage.delta, error, turn.completed`. Every event has `{ seq, ts, type, payload }`; payload is size-bounded (8 KB) on the DB path, full on the jsonl path. Each adapter ships a parser from the CLI's JSON stream into this enum; unknown CLI events map to `runtime.raw` with the original type in payload (kept, never dropped).

### 8.3 Per-CLI mapping (verified against installed versions on 2026-09-03)

| Concern | claude 2.1.258 | codex 0.149.1 | opencode 1.18.27 | gemini 0.58.0 |
|---|---|---|---|---|
| Headless turn | `claude -p --output-format stream-json --verbose` | `codex exec --json -C <cwd> -` (prompt on stdin) | `opencode run --format json --dir <cwd>` | `gemini -p <prompt> -o stream-json` |
| New session with known id | `--session-id <uuid>` | (id returned in events) | (id returned in events) | `--session-id <uuid>` |
| Resume | `--resume <id>` | `codex exec resume <id> -` | `opencode run -s <id>` | `--resume <id>` |
| Fork | `--resume <id> --fork-session` | `codex exec fork <id>` | `--fork` with `-s` | not supported |
| System prompt | `--system-prompt-file` (replace) or `--append-system-prompt-file` (first turn only) | `-c` instructions via `AGENTS.md` in cwd / `--add-dir`; no direct flag → `file_only` | `--agent <name>` with agent file in `.opencode/` or AGENTS.md → `file_only` | `GEMINI.md` in cwd → `file_only` |
| Structured output | `--json-schema <schema>` | `--output-schema <file>` + `-o <file>` | not native → parse fenced JSON in final text | `-o json` then parse |
| MCP | `--mcp-config <file> --strict-mcp-config` | `-c mcp_servers.<name>.url=...` or `codex mcp add` in `CODEX_HOME` | `opencode mcp` config in `.opencode/opencode.json` in cwd | `--mcp-config`-equivalent via `.gemini/settings.json` |
| Permissions | `--permission-mode {auto,acceptEdits,dontAsk,bypassPermissions}`, `--allowedTools`, `--disallowedTools` | `--sandbox {read-only,workspace-write,danger-full-access}`, `--approve-for-me` | `--auto` | `--approval-mode {auto_edit,yolo,plan}` |
| Budget | `--max-budget-usd` | n/a | n/a | n/a |
| Model / effort | `--model`, `--effort` | `-m`, `-c model_reasoning_effort=` | `-m provider/model`, `--variant` | `-m` |
| Isolation of config | `--setting-sources user` + `--bare` optional; `CLAUDE_CONFIG_DIR` env for a per-workspace config dir | `CODEX_HOME` env per workspace | `XDG_CONFIG_HOME`/`OPENCODE_CONFIG` per workspace | `GEMINI_CLI_HOME`-style env per workspace (verify) |
| Warm process (later) | `--input-format stream-json` | `codex app-server` (JSON-RPC, schema via `generate-json-schema`) | `opencode serve` + `run --attach` | n/a |

Decisions:
- **Claude is the reference adapter** and the only one required for M1. It supports every capability.
- Codex, OpenCode, Gemini use `file_only` prompt injection: the rendered charter+brief is the `AGENTS.md` (Codex, OpenCode) / `GEMINI.md` (Gemini) at the worker home, which is cwd, so every CLI discovers it natively; Claude additionally gets it via `--append-system-prompt-file` on the first turn of a session (its `CLAUDE.md` at home is a `@AGENTS.md` pointer). Because the worktree is `work/` under cwd, the project's own `AGENTS.md`/`CLAUDE.md` inside it is read by the CLIs as nested project instructions (Claude reads nested `CLAUDE.md`; for Codex/OpenCode/Gemini the `agent-conductor-worker` skill instructs the worker to read `work/AGENTS.md` first). Nothing is ever written into the project's discovery files. Implementer: verify nested-instruction behavior per CLI in M5 and record it in `docs/adr/`.
- `listModels()` is mandatory. Claude: static alias list (`fable`, `opus`, `sonnet`, `haiku`) plus full ids, marked `static`; OpenCode: `opencode models` output (`detected`); Codex: static list from the pinned version plus any `-c model=` the human adds; Gemini: static. The UI and `conductor role set-model` show only models from the role's runtime, and the conductor's model is chosen the same way (`conductor conductor set-model`, or the workspace settings page).
- Each runtime gets a **per-workspace config home** (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_CONFIG_HOME`) under `.agent-conductor/runtimes/<runtime>/` so agent runs never mutate the human's personal CLI config, and so session stores are per workspace. Authentication is inherited by copying/linking credential files on `conductor runtime login <id>` (documented per CLI; Claude: `claude setup-token` or OAuth in that config dir).
- Permission posture default: `auto`-style with a deny list (`git push --force`, `rm -rf` outside worktree, network to non-allowlisted hosts where the CLI can express it). `bypass` is opt-in per agent and warned about in the UI.

### Implementation notes

Package per runtime with: `adapter.ts`, `args.ts` (pure function `buildArgs(input) → string[]`, unit-tested), `events.ts` (stream parser, golden-tested against recorded fixtures in `fixtures/*.jsonl`), `session.ts`. Shared: `runtime-sdk/src/process.ts` (spawn in process group, stdout line reader, stderr capture, kill escalation), `runtime-sdk/src/testkit.ts` (fake CLI binaries that emit fixtures). Record fixtures by running each real CLI once with a trivial prompt; keep them small.

---

## 9. Agent ↔ control-plane protocol

Agents never touch the database or the filesystem outside their scope to communicate. They use the daemon's MCP tools (preferred) or the `conductor` CLI (same operations, for runtimes with weak MCP support or for humans).

### 9.1 Run token and scope

Each run receives `AC_API_URL`, `AC_RUN_TOKEN`, `AC_RUN_ID`, `AC_AGENT_ID`, `AC_ROLE_ID`, `AC_WORKSPACE_ID`, `AC_PROJECT_ID`, `AC_TICKET_ID` (workers), `AC_WORKTREE` (workers), `AC_WAKE_REASON`. The token's scope for a worker: read its own project's tickets, its project KB and `SHARED.md`; write only its own ticket subtree and its project KB. It cannot read other projects' tickets, KBs, or `WORKSPACE.md`. The conductor reads everything and writes the workspace KB. Conductor tokens additionally allow ticket creation in any project, hiring, assignment, and worker control.

### 9.2 MCP tools (server `agent-conductor`)

Prefix `ac_`. Names are stable API; descriptions carry the rules so skills can stay short.

Common (all agents):
- `ac_inbox()` → wakes bundled into this run: messages, ticket events, answered decisions, mentions, steering from the conductor. Call first.
- `ac_ticket_get(id)`, `ac_ticket_list(filter)`, `ac_ticket_comments(id, after?)`.
- `ac_ticket_checkout(id)` → 409 on conflict (never retry). `ac_ticket_release(id, note)`.
- `ac_ticket_comment(id, body, kind=comment)`; `ac_ticket_document_put(id, key, body)` (revisioned; plan/report); `ac_ticket_document_get(id, key=report, revision?)` (read scope: own project for a worker, everything for the conductor; `not_found` carries the keys that do exist).
- `ac_ticket_transition(id, to, {note, unblock?: {owner, action}, blockedBy?: [ids]})` → applies guards.
- `ac_ticket_work_product(id, {type, url, title, state})`.
- `ac_ask(ticketId?, {title, context, options[], recommendation, allowFreeText, correlationKey})` → creates a decision owned per policy (human by default; the conductor may answer `gate_finding`s that are unambiguous). The run should end after asking; the answer arrives as a wake.
- `ac_report({state: working|needs_decision|blocked|paused|done|failed, key?, note})` → firstmate status protocol; writes a `status` comment and updates liveness. Sparingly: phase changes only.
- `ac_knowledge_get(scope)` → `scope` is `shared` (SHARED.md), `project` (own project KB; conductor passes a project id), `workspace` (conductor only), `decisions` (conductor only).
- `ac_knowledge_note(scope, section, text)` → append one concise, dated entry to a KB section (worker: own project KB only; conductor: workspace KB). The daemon rejects entries over 60 words, duplicates (near-match on an existing entry), and anything that would exceed the file's budget, returning the current size and the sections that are over; over-budget writes schedule a curation run instead of being silently dropped.
- `ac_knowledge_replace(scope, body)` → full rewrite; only available inside a curation run (§13.4) or to the human.
- `ac_openspec_status(ticketId)` → the daemon's cached view of the bound change (planning complete, tasks, validation).
- `ac_spec_list(projectId)`, `ac_spec_get(projectId, capability)`, `ac_spec_search(projectId?, query)`, `ac_spec_change_get(changeName)` → the spec index (§12.5); workers are scoped to their own project.
- `ac_ticket_merge_done(id, {mergeCommit, method})` → the agent reports that it merged its approved PR; the daemon verifies against the forge/default branch before accepting.
- `ac_worktree_status()` → the worker's worktree path, branch, dirty flag, ahead/behind default, landed evidence (so the worker never guesses).

Conductor only:
- `ac_ticket_create({projectId?, kind, title, description, priority, parentId?, blockedBy?, assigneeRoleId?, autoMerge?})` — `autoMerge` only when the human asked for it in the same request.
- `ac_ticket_assign(id, roleId)` → the daemon spawns a worker when a slot is free; `ac_ticket_set_priority`.
- `ac_role_list()`, `ac_role_get(id)` (spec, charter, scope, status, live workers, recent outcomes).
- `ac_role_hire(spec)` → §10.4; returns a `pending_activation` role, or `active` when `hireApproval=none`.
- `ac_role_update_charter(id, {charter, reason, applyToRunning?})` → new role revision.
- `ac_role_set_max_workers(id, {maxWorkers, reason})` → new role revision; returns the role and its `concurrency`. Raising applies from the next spawn sweep; lowering never cancels a live worker. The project limit still applies, so the effective concurrency is the smaller of the two.
- `ac_role_pause(id, reason)` / `ac_role_resume(id)` / `ac_role_retire(id, reason)` (retire with live workers requires a human decision).
- `ac_worker_list(filter)`, `ac_worker_get(id)` (ticket, status, worktree state, last report, spend).
- `ac_worker_message(workerId, message)` → steering: a comment on the worker's ticket plus a wake (`conductor_request`). The worker acknowledges by acting or by `ac_report`.
- `ac_worker_relaunch(id, note)` / `ac_worker_cancel(id, reason)` (cancel leaves the worktree; discarding unlanded work is a human `discard_approval`).
- `ac_decision_answer(id, {key?, text})` for decisions owned by the conductor.
- `ac_human_send(threadId?, body)` → outbound message to the human on the originating channel (the only way the conductor's text reaches the human; plain assistant text is captured as the run's summary but NOT delivered — Synapse's `send_to` rule). Workers do not have this tool: a worker talks to the human only by commenting on its ticket (`ac_ticket_comment`), and the daemon relays ticket comments to any thread bound to that ticket (§11.7).
- `ac_briefing()` → deterministic snapshot JSON (§10.5) for status reports.
- `ac_project_list()`, `ac_project_add(url, opts)` (requires human decision), `ac_usage(filter)` (same windows as §16.3).

Every tool response includes `{ ok, data | error: { code, message, retryable } }`; unknown ids return `not_found`, not exceptions.

### 9.3 Turn prompt (built by the daemon)

Structure (markdown, ≤ 2k tokens typical; bounded lists with remainder counts):

```
# Turn <epoch> for <agent name> (<kind>) — <ISO time>
## Why you were woken
- <source>: <reason>  (one line per bundled wake; e.g. "human_message: 'Add dark mode to the dashboard' from Victor via telegram")
## Your ticket (workers)
- ACME-42 [approved] Add dark mode — worktree work/ on ac/acme-42-dark-mode (clean, 0 ahead / 3 behind main); last status: needs_decision resolved
## Open work (conductor)
- ACME-42 [in_progress] Add dark mode — Backend Engineer #7, working: tests passing   (max 10, then "+N more, call ac_ticket_list")
## Answered decisions
- D-7 (ACME-42): "Use CSS variables" — answered by Victor: "yes, variables"
## Notes
- <charter changed since last turn: summary>   (only when applicable)
- <session bootstrap digest when session is fresh/stale: SHARED.md + project KB + top rules>
## What to do now
Call `ac_inbox` if you need details, do the work, report via ac_report / ac_ticket_*, and finish with the structured final report.
```

For the conductor the same shape lists human messages per thread, pending decisions owned by the human (so it can nudge), tickets waiting for a worker slot, and the supervisor digest.

### 9.4 Structured final report

Every turn ends with the agent producing JSON matching `RunReportSchema` (via `--json-schema`/`--output-schema` where supported, else a fenced ```json block that the engine extracts):

```json
{ "state": "done|working|blocked|needs_decision|paused|failed|idle",
  "summary": "one paragraph for the record",
  "tickets": [{"id": "ACME-42", "status": "in_progress", "note": "…"}],
  "nextAction": {"owner": "self|conductor|human|none", "what": "…"} ,
  "knowledgeUpdated": false }
```

`idle` means "nothing actionable" and is the cheap fast path: the engine records liveness `empty` without penalty when the wake was a digest or timer. Missing report ⇒ `liveness=empty` and a warning event; three consecutive empties on non-digest wakes ⇒ conductor `gate_finding`.

### 9.5 `conductor` CLI for agents

`conductor agent inbox`, `conductor ticket get|list|checkout|comment|transition|doc put|work-product`, `conductor ask`, `conductor report`, `conductor memory`, `conductor knowledge`, `conductor human send` — thin wrappers over the same HTTP endpoints using `AC_RUN_TOKEN`. Output JSON with `--json`; human-readable otherwise. Skills reference MCP tools first and the CLI as fallback.

---

## 10. The conductor

### 10.1 Role

One conductor per workspace. It is the only agent the human needs to talk to. It:
- receives human messages from any channel and answers in outcome language;
- creates tickets from requests (one ticket per distinct deliverable; decomposition rules in the `agent-conductor-planning` skill);
- picks the project and the **role** (project by the portfolio in WORKSPACE.md and each PROJECT.md Overview; role by `scope_text` and charter summary; asks one question when ambiguous); the daemon spawns a worker from that role for the ticket;
- hires a role when none fits (§10.4);
- assigns, then supervises workers via the digest wakes; steers them with `ac_worker_message`; unblocks, answers unambiguous gate findings itself, escalates real decisions to the human one at a time;
- maintains workspace knowledge (`knowledge/`), its own memory, and refines role charters when it sees repeated mistakes across workers;
- produces briefings (§10.5).

Hard rules (in priority order, in its prompt): (1) never writes to a project or worktree; (2) never merges or approves on the human's behalf unless the project policy grants it; (3) never destroys unlanded work; (4) workers never address the human except through direct chat threads the human opened; (5) reports outcomes faithfully, evidence ≠ authorization.

### 10.2 Runtime

The conductor is an agent like any other: `kind=conductor`, cwd = `conductor/`, persistent session, its runtime chosen in `workspace.yaml` (default Claude). It has read access to `knowledge/` and to project summary cards, and read-only access to project clones through `ac_*` tools and, optionally, `--add-dir projects/<id>` for reading code when investigating (it MUST NOT edit; the runtime permission deny list blocks writes outside `conductor/`).

### 10.3 Intake loop (per human message)

1. Read the message and thread context (`ac_inbox`).
2. Classify: question (answer directly from the knowledge bases and the spec index; no ticket), status request (use `ac_briefing`), work request, decision answer (route to the decision), configuration (add project, change policy → decision or `ac_project_add`).
3. For work: resolve project (explicit > follow-up referent > match against the portfolio in WORKSPACE.md and each PROJECT.md Overview; ask if ambiguous). Create a ticket (`change` by default when code changes are implied; `scout` when the request is diagnostic; `task` for chores; `question` when an agent must answer but not change code). Set kind, priority, description with acceptance criteria, blockers.
4. Choose a role: existing role whose scope matches → assign (a worker spawns automatically; if the role is at `max_workers` the ticket waits and the conductor says so). No match → hire (§10.4) → assign once active (if `pending_activation`, tell the human what was hired and that they can switch the CLI before the first worker runs).
5. Reply to the human with what is under way, in outcome language, then end the turn.

### 10.4 Hiring

Hiring produces a **role spec** and a **charter**, both versioned:

`roles/<id>/role.yaml`
```yaml
id: api-backend
name: Backend Engineer
project: api
charterSummary: Owns the api service: HTTP handlers, persistence, migrations, tests.
scope: Backend/API work in the api repo, including data model and migrations; not frontend, not infra.
responsibilities: [ ... ]
capabilities: [ node, postgres, drizzle, vitest ]
runtime: codex            # from project default; the human can switch before activation
model: null
effort: high
sessionPolicy: per_ticket  # per_ticket | fresh
maxWorkers: 2
permission: { mode: auto, denied: ["git push --force*"] }
secrets: []               # names of workspace secrets exposed as env
memoryBudgetTokens: 2000
createdBy: conductor
createdAt: 2026-09-03T10:00:00Z
```

Charter (`CHARTER.md`) is rendered from `templates/charter.md.tmpl` (see `docs/prompts/worker.AGENTS.md.tmpl`, which shows charter and brief together as a worker sees them) with the spec fields plus the fixed operating contract (status protocol, ticket rules, OpenSpec flow, project boundary, reporting contract "you report to the conductor through your ticket; you never address the human unless in a direct thread").

Conductor's hiring procedure (skill `agent-conductor-hire`):
1. Check overlap: list roles in the project; if a charter matches or highly overlaps, reuse; if partial overlap, hire and clarify the distinction in **both** charters (firstmate's rule). A role is a kind of work, not a person: one "Backend Engineer" role serves any number of concurrent backend tickets.
2. Draft spec: role, one-sentence charter summary, natural-language scope (used for routing), responsibilities (5–9 bullets), capabilities, rules specific to this project (from the project KB), runtime = project default.
3. `ac_role_hire(spec)` → daemon validates, writes files, creates a `pending_activation` role, creates a `hire_approval` decision for the human **if** `workspace.defaults.hireApproval=human` (default) — the decision card shows the spec and a "switch runtime" choice (claude/codex/opencode/gemini). Answering activates. With `hireApproval=none` the role activates immediately; the human can still switch runtime via `conductor role set-runtime` (applies to workers spawned afterwards).
4. Daemon writes the role directory transactionally (spec, charter, empty memory). Workers are provisioned later, per ticket (§11.2).
5. When the conductor sees repeated mistakes across workers, it calls `ac_role_update_charter` with a reason; the daemon records a revision; the human can roll back.

### 10.5 Briefing

`ac_briefing()` returns a deterministic snapshot `{ needsYou: [...], landed: [...], underway: [...], queued: [...], warnings: [...] }` computed by the daemon (tickets by status and decisions by owner within a window). The conductor renders firstmate's four sections, always all four, never a delta: **Needs you** / **Recently landed** / **Under way** / **Up next**. One decision at a time when the human asks "what do you need from me": the conductor presents the highest-impact open decision with what/why-now/options/recommendation.

### 10.6 Language

The conductor speaks in outcomes: the fix, the PR, the review, the decision, the blocker, the agent (by name), the project. It never exposes run ids, wake sources, session policies, worktrees, or supervisor mechanics unless the human asks. The translation table lives in the conductor prompt (derived from firstmate §9 but with our own, smaller vocabulary so less needs translating).

---

## 11. Roles and workers

### 11.1 Model

A **role** is what the conductor hires: a template scoped to one project (charter, runtime, model, `max_workers`). A **worker** is what runs: spawned from a role for one ticket, with its own home, brief, worktree and session, and retired when the ticket's work has landed. This is firstmate's crewmate model: the conductor never talks to "the backend engineer" as a person; it assigns a ticket to the Backend Engineer role and a fresh worker picks it up. Concurrency is the number of live workers, bounded per role and per project.

A worker's write scope: its worktree (`workers/<id>/work/`), its ticket and that ticket's descendants, and its project's KB (`knowledge/projects/<project>/PROJECT.md`, concise dated entries only). It reads its project repo (through the worktree), its project KB, `SHARED.md`, and its ticket. It cannot see other projects' code, tickets or KBs, other workers' worktrees, or `WORKSPACE.md` (which lists the portfolio). Cross-project needs become a `blocked` transition with `unblock_json {owner: conductor, action}` or an `ac_ask`; the conductor creates the courier ticket in the other project.

### 11.2 Spawn, brief, home

Trigger: a ticket is assigned to a role and the role has a free slot (`role.max_workers`, `project.max_workers`). When several assigned tickets are waiting, the supervisor takes them in queue order — highest priority first (`critical` > `high` > `medium` > `low`), creation time breaking ties; running workers are never preempted. The supervisor spawns transactionally:

1. Create the `agents` row (`kind=worker`, `status=provisioning`), name `<Role name> #<n>` (n increments per role, for humans; the id is a ULID).
2. Create the home `workers/<id>/` with skills for the runtime.
3. Create the worktree through the project's worktree provider (§11.5) on branch `ac/<ticket>-<slug>` at `workers/<id>/work/`, running `setup_command` once. Record the `worktrees` row.
4. Render `AGENTS.md` = role charter + **brief**. The brief (firstmate's `fm-brief.sh`; generated by the daemon from structured ticket data, never from the conductor's prose alone):
   - **Task**: ticket identifier, title, description, acceptance criteria, kind, priority, links (parent, blockers), the OpenSpec change name for `change` tickets.
   - **Setup**: worktree path and branch; "verify with `ac_worktree_status` before anything else; if the path or branch differs, stop and report `blocked`".
   - **Rules**: project boundary, delivery mode, never push default / never merge outside `merging`, status protocol, when to `ac_ask`, when to stop.
   - **Definition of done**: per kind and delivery mode (e.g. change+pr: "artifacts complete → `proposed`; after approval implement all tasks → PR → `in_review`; after merge approval merge → `ac_ticket_merge_done`").
   - **Context pointers**: project KB, `SHARED.md`, `work/AGENTS.md`, OpenSpec `config.yaml` context. Pointers, not contents; the bootstrap digest injects the budgeted ones.
5. Create the session placeholder, bind the ticket (`tickets.worker_id`, checkout), set `status=active`, enqueue the first wake (`ticket_assigned`).

Any failure rolls back the row, the home and the worktree (provider `remove --force` on a worktree with no commits). The brief is revisioned (`brief_revision`); a changed ticket description or acceptance criteria while the worker is live produces a brief revision and a "brief updated" note in the next turn prompt.

### 11.3 Lifecycle of a worker turn (what the charter+brief tells it)

1. `ac_inbox` → why you were woken (first turn: your brief; later: approval answered, comment, steering, merge approved, relaunch note).
2. `ac_worktree_status` on the first turn and after any relaunch; read `work/AGENTS.md` once (the project KB and SHARED.md are already in your bootstrap).
3. Do the phase the ticket status asks for (§12); report phase changes with `ac_report`; leave durable progress as comments/documents/work products; transition honestly.
4. Same obstacle twice → `ac_report blocked` + transition `blocked` with a routable path; end the turn.
5. A decision above you (product choice, destructive action, contract expansion) → `ac_ask` with options and a recommendation; end the turn. The answer arrives as your next wake.
6. Durable learnings that would help the next worker on this project → one concise `ac_knowledge_note` into the project KB (rules in the knowledge skill). Facts every contributor needs regardless of AgentConductor → the repo (through your PR).
7. End with the structured final report. An empty inbox is an idle turn; never invent work.

### 11.4 Delivery and merge

Per project policy `deliveryMode`:
- `pr` (default): work on the ticket branch in `work/`, push, open a PR with `gh` (or the forge plugin), record a `pull_request` work product, transition `in_review`. Unless the ticket has `auto_merge` on, a `merge_approval` decision **owned by the human** is created; the conductor can never approve a merge.
- `local-branch`: no push; transition `in_review` with a `branch` work product; on approval the same worker merges into the local default branch through the daemon (`ac_ticket_merge_done` triggers a fast-forward in `projects/<id>`; if not fast-forwardable the worker rebases first).

**The worker that implemented the ticket performs the merge, never without human consent, and only when the project's merge queue admits it.** Consent is either the human's `approve` on the merge decision, or the ticket's `auto_merge` flag (default off). `auto_merge` can be set by the human on the ticket (`conductor ticket set ACME-42 --auto-merge`, the ticket page toggle, or a Telegram `/automerge ACME-42`), or by the conductor at creation when the human said so ("build X and merge it when done" → `ac_ticket_create({..., autoMerge: true})`); the conductor MUST NOT set it on an existing ticket on its own initiative. With `auto_merge` on, the daemon moves the ticket to `merging` as soon as the PR is open and CI is green (or immediately when the project has no CI), and the human is told the merge is proceeding. In either case the ticket moves to `merging` and **joins its project's merge queue** rather than merging at once. Joining stamps `tickets.merge_queued_at`; the queue admits waiting tickets in join order (ties broken by ticket number) while fewer than the project's `mergeConcurrency` policy (integer ≥ 1, default 1) are in the active merge step, stamps `tickets.merge_started_at`, brings a worker back if the ticket has none, and wakes it. A ticket waiting in the queue is neither spawned for nor treated as a liveness violation — the queue is its action path — so ten workers can be building while the queue lands one at a time. Leaving `merging` for any status (merged, blocked, sent back for changes) clears both stamps and admits the next ticket, so a failed merge never holds the queue; the supervisor also pumps every project's queue on its tick, so a restart cannot strand it. The queue is readable at `GET /projects/:id/merge-queue`, as `conductor ticket merge-queue`, and on the board and ticket pages. Rationale and the departure from §11.5 are in `docs/adr/0006-merge-queue.md`. When the queue admits it, the worker is woken. It fetches, rebases onto (or merges in) the default branch, **resolves conflicts itself** (re-running tests and lint; if a resolution changes behavior the spec described, it asks with `ac_ask` before merging), pushes with `--force-with-lease`, waits for CI when required, merges the PR with `gh pr merge --<mergeMethod>` (default `squash`), and reports `ac_ticket_merge_done`. The daemon verifies the branch's content reached the default branch — ancestry, then identical trees, then the branch's cumulative patch id against the commits the default branch gained since the merge base (a squash of a multi-commit branch), then every commit present individually — fast-forwards `projects/<id>` (one landing at a time per project), archives the OpenSpec change (§12.2), runs the landed-work test, removes the worktree, retires the worker, and moves the ticket to `done`. If the merge cannot complete (CI red after rebase, unresolvable conflict, forge error) the worker transitions to `blocked` with `{owner: conductor, action}`; the conductor decides (steer, relaunch, cancel, escalate).

Rules: workers MUST NOT push to the default branch except through the merge of an approved PR, MUST NOT merge unless their ticket is in `merging`, MUST NOT force-push shared branches. The daemon enforces the gate (`merging` is only reachable through the human's approval or the `auto_merge` flag; `ac_ticket_merge_done` is rejected outside it); the forge enforces branch protection (setup docs recommend "require PR" on the default branch); the runtime deny list blocks direct default-branch pushes where expressible; reconciliation detects violations.

### 11.5 Worktrees: provider interface, worktrunk default

Isolation unit = **one git worktree per worker (= per ticket)**, addressed by branch name, created at spawn, removed only when the work has landed.

```ts
export interface WorktreeProvider {
  readonly id: "worktrunk" | "git" | string;
  detect(): Promise<{ available: boolean; version?: string }>;
  create(input: { repoPath: string; branch: string; base: string; targetPath: string; setupCommand?: string }): Promise<WorktreeInfo>;
  list(repoPath: string): Promise<WorktreeInfo[]>;                 // authoritative state, mirrored into `worktrees`
  remove(input: { path: string; deleteBranch: boolean; force: boolean }): Promise<void>;
  syncBase?(path: string): Promise<void>;                          // provider-specific "rebase/merge base" helper (wt merge-style), optional
}
```

- **worktrunk** (`wt` v0.68.0; Rust; Arch package `extra/worktrunk`; "Git worktree management for parallel AI agent workflows") is the default provider. Verified contract in `docs/research/worktrunk.md`. The daemon invokes it as `wt -C <primary-clone> --config <workspace>/.agent-conductor/wt.toml --config-set 'worktree-path="<workspace>/workers/<workerId>/work"' -y switch --create ac/<ticket>-<slug> --base <default> --no-cd --format json`, so the human's personal worktrunk config is never read or written and the worktree lands exactly at the worker's `work/`. State is mirrored from `wt list --format json` (schema 2: per-branch dirty flags, ahead/behind the default branch, predicted `merge_conflicts`). Warm-up is a user-config `pre-start` pipeline in the generated `wt.toml`: `wt step copy-ignored --from main` (copies gitignored caches such as `node_modules` from the primary clone) followed by `project.setup_command`; user-config hooks need no interactive approval, project-config hooks do, so the daemon never relies on a repo's own `.config/wt.toml`. Removal is `wt remove <branch> --foreground --format json --no-delete-branch` (the daemon deletes the branch itself only after the landed-work test; `wt remove` refuses dirty worktrees without `--force`, which the daemon never passes except on a human-approved discard). Two quirks to code around: `wt remove` exits 0 on refusal (check the JSON and the path), and its JSON `branch_deleted` field is unreliable (check `git branch`).
- **git** (built-in fallback, always available): `git worktree add -b <branch> <path> <base>`, `git worktree list --porcelain`, `git worktree remove`; warm-up = `rsync` of gitignored cache directories listed in `project.warmPaths` plus `setup_command`, run by the daemon. Used when worktrunk is missing, or per project (`worktrees: git`). Both providers pass the same contract test; the M2 demo runs with both.
- **Rejected**: `agenttools/worktree` (Claude-only, GitHub-issue-bound, macOS/iTerm2 + tmux, no merge workflow, spawns its own Claude workers with coordination files, which is AgentConductor's own job).
- **Never reset, never clean.** The engine and supervisor never run `git reset`, `git clean`, `git checkout` or `git stash` in a worker's worktree. Only the worker changes its state.
- **Remove = landed-work test (firstmate's teardown rule).** A worktree is removed only when the work has provably landed: every commit on the ticket branch is reachable from a remote-tracking branch, **or** the ticket's PR is merged and the default branch contains the branch's content (squash-merge-then-delete), **or** for `local-branch` mode the local default branch contains it. Uncommitted changes never count. If the daemon cannot tell (forge unreachable, ambiguous history) it refuses and marks the worktree `dirty`; nothing is discarded. `conductor ticket discard <id> --force` is the only path that removes an unlanded worktree, and it creates a `discard_approval` decision for the human first.
- **Cancelled tickets** keep worker home and worktree as `dirty` until discarded or landed elsewhere (the conductor may ask the worker to push the branch for the record before cancelling).
- **Worker retirement**: after removal the home is moved to `archive/workers/<id>/` (brief, notes, final report); run logs stay under `.agent-conductor/runs/`. `conductor worker purge` deletes archives older than `workerArchiveDays` (default 30).
- **Concurrency**: many workers per project, each in its own worktree; conflicts surface at merge time and are resolved by the merging worker (§11.4). Building is serialized only on declared blockers. **Landing is serialized by the project's merge queue** (§11.4, `mergeConcurrency`, default 1), because every ticket of a project shares one primary clone; see `docs/adr/0006-merge-queue.md`.

### 11.6 Stuck-worker ladder and relaunch

Supervisor ladder (firstmate's stuck-crewmate recovery), per worker: (1) silence past `silenceTimeoutSec` with no worktree writes → interrupt, then kill the process group; (2) **relaunch** into the same home and worktree, resuming the same session where possible, with the brief plus a progress note derived from the ticket (last status, tasks ticked in `tasks.md`, dirty files, last commit); (3) second relaunch failure → new session for the same worker with the bootstrap digest; (4) third failure → worker `error`, ticket `blocked {owner: conductor}`, conductor woken with the evidence; (5) the conductor may cancel and reassign; a replacement worker starts from the branch that exists, never from scratch (its brief's Setup names the existing branch and its state).

### 11.7 Direct chat with a live worker, through its ticket

Chat exists in exactly two places: with the conductor, and with a live worker **through its ticket**. There are no chat workers and no "talk to a role"; a role is a template, and questions about a project go to the conductor, which answers from the project KB or creates a `question` ticket.

Talking to a worker: the human comments on the ticket (web ticket page, `conductor ticket comment`, `conductor attach <worker>` whose input line posts a ticket comment, or Telegram `/talk <ticket>` which binds the thread to that ticket until `/conductor`). The comment is stored as a `ticket_comment` with `author_kind=human`, wakes the worker (`ticket_comment`), and the worker answers with `ac_ticket_comment`; the daemon relays worker comments back to every thread bound to that ticket and to the web page live. Everything the human and the worker say to each other is therefore on the ticket's record, visible to the conductor, and survives the worker's retirement. When the worker is retired, comments still land on the ticket and the conductor is woken instead.

---

## 12. Tickets and the OpenSpec workflow

### 12.1 Binding

For `change` tickets in OpenSpec-enabled projects, the daemon computes the change name at assignment time (`<identifier-lowercase>-<slug>`, e.g. `acme-42-dark-mode`) and stores it in `tickets.openspec_change_name`. The **worker** creates it as the first step of its first turn, inside its worktree (already on branch `ac/acme-42-dark-mode`): `cd work && openspec new change "acme-42-dark-mode" --goal "<title>" --json`. The change therefore lives in the branch, is reviewed with the code, and is archived after merge. The daemon never writes into a worktree; it verifies existence when the worker requests the `proposed` transition. No custom keys are written into `.openspec.yaml`. The turn prompt states the exact name and that it must be created if absent, so the OpenSpec skill's "does a change with that name exist?" question never fires.

`task` tickets in OpenSpec projects also get a change; the worker writes `skip_specs: true` into `.openspec.yaml` right after creating it (so `validate` passes without spec deltas) unless the project sets `taskTicketsUseOpenspec: false`. `scout` and `question` tickets never create changes.

### 12.2 Flow for a `change` ticket

```
todo ──(worker spawned; turn 1: /opsx:propose <change>)──▶ proposing ──(daemon observes isPlanningComplete && validate ok)──▶ proposed
proposed ──(plan_approval decision: approve)──▶ approved ──(same worker, next turn: /opsx:apply <change>)──▶ in_progress
in_progress ──(apply all_done; worker delivers PR)──▶ in_review ──(human approves, or auto_merge && CI green)──▶ merging ──(same worker merges; daemon verifies)──▶ done
                                                                                                          │
                                                            daemon: ff primary clone, openspec archive --yes --json, remove worktree, retire worker
```

Detailed rules:
1. **Propose turn.** The worker's first turn prompt says: "Ticket ACME-42 is `todo`. Your worktree is `work/` on branch `ac/acme-42-dark-mode`. Create OpenSpec change `acme-42-dark-mode` there with `openspec new change` if it does not exist (do not ask). Then run the OpenSpec propose workflow for it. Write proposal, specs, design, tasks. Do not implement. If the request is materially ambiguous, call `ac_ask` with concrete options instead of asking in text. When artifacts are complete, transition to `proposed`." The worker invokes the installed OpenSpec skill (`/opsx:propose` on Claude/OpenCode, `$openspec-propose` on Codex).
2. **Proposed gate (daemon).** On transition request to `proposed`, the daemon runs `openspec status --change <c> --json` and `openspec validate <c> --json --strict` in the ticket's leased worktree (read-only commands). If `isPlanningComplete` is false or validation has errors, the transition is rejected with the issues; the worker fixes them. On success the daemon writes a `plan` document revision on the ticket containing proposal.md + tasks.md (rendered), and creates a `plan_approval` decision owned per project policy (`human` default; `conductor` allowed; `none` auto-approves). The decision target is the plan document revision, so a new revision supersedes an open approval.
3. **Approval.** Human answers on any channel (`approve` / `revise: <feedback>` / `reject`). `revise` puts the ticket back to `proposing` with the feedback as a comment and a wake; `reject` cancels; `approve` → `approved` + wake.
4. **Apply turns** (same worker, same session, so it remembers its own proposal). Prompt: "Your plan for `acme-42-dark-mode` was approved. Run the OpenSpec apply workflow: implement pending tasks, tick them in tasks.md as you complete them, commit as you go. Pause with `ac_ask` on scope expansion. Deliver per `deliveryMode` when all tasks are done." The daemon polls `openspec instructions apply --change <c> --json` after each turn to mirror `progress` into `openspec_state_json` and the UI. Workers MUST NOT run `/opsx:archive`.
5. **Review.** On delivery the worker records the work product and transitions `in_review`. A `merge_approval` decision owned by the human is created, unless the ticket has `auto_merge` on, in which case the daemon waits for CI and proceeds. Optional: the conductor may create a `scout` review ticket for a reviewer role (`sessionPolicy=fresh`), whose deliverable is a `report` document; the verdict is the deliverable (`done`), never `blocked`.
6. **Merge (by the same worker).** On the human's `approve` (or auto-merge with green CI) the ticket moves to `merging` and joins the project's merge queue; the worker is woken when the queue admits it (at most `mergeConcurrency` tickets merge at once, default 1). It syncs with the default branch, resolves conflicts, re-runs checks, merges the PR per `mergeMethod`, and reports `ac_ticket_merge_done` (§11.4). A human merging manually on the forge is also fine: reconciliation detects the merged PR and proceeds identically.
7. **Archive (by the daemon).** After the merge is verified, the daemon fast-forwards `projects/<id>`, runs `openspec archive <c> --yes --json` **in the primary clone on the default branch**, commits `chore(openspec): archive <c>` and pushes (policy `archiveCommit: push | pr | local`, default `push`; with branch protection use `pr`, which opens a tiny PR the conductor may merge under policy). Archive is serialized per project. Then the landed-work test runs, the worktree is removed, the worker retired, and the ticket → `done`. If archive fails, the ticket stays `merging` with `unblock_json {owner: conductor, action: "openspec archive failed: <code>"}` and the conductor is woken.

### 12.3 Flow for other kinds

- `task`: `todo → in_progress → in_review → done` (skips propose/approval unless the project sets `taskApproval: human`). Uses the OpenSpec change (skip_specs) only as a tasks.md tracker if enabled.
- `scout`: `todo → in_progress → done`; deliverable is the `report` document; the worker MUST NOT push or open PRs; it may create throwaway branches locally. The report format: what you did, what you found, evidence (commands, file:line), recommendation. The conductor reads reports and decides whether to create a `change` ticket (evidence ≠ authorization).
- `question`: `todo → done`; answer is a comment.

### 12.4 OpenSpec adapter (`core/openspec/`)

A typed wrapper over the CLI (never import the package): `newChange`, `statusAll`, `list`, `instructionsApply`, `validate`, `archive`, with `cwd`, `--json`, env `CI=1 OPENSPEC_TELEMETRY=0 OPENSPEC_NO_UPDATE_CHECK=1 NO_COLOR=1`, one JSON doc from stdout, 30 s timeout, `root.path` asserted equal to the expected clone root. Pinned version per project (`openspec_version`); `conductor project openspec-upgrade` diffs the generated SKILL.md files and requires confirmation. Installation: `openspec init --tools <runtime tools>` in the primary clone at project add time (committed if the repo has no `openspec/` yet — as a `task` ticket "Adopt OpenSpec" assigned to the first role, so the human reviews it as a PR).

Per-project OpenSpec `config.yaml` `context:` is generated by the daemon from the project KB + SHARED.md (≤ 4k tokens) and kept in sync (only the `context` and `rules` keys; a marker comment delimits the generated block).

### 12.5 Spec index and Spec Explorer

OpenSpec leaves a spec document behind for nearly every feature: main specs under `openspec/specs/<capability>/spec.md` are the source of truth after archive; active changes carry proposal, design, tasks and delta specs; archived changes are the history of why each requirement exists. That makes specs part of the project's knowledge, and they are explored in the UI the same way the knowledge base is.

**Index (daemon, `core/openspec/index.ts`).** Per project the daemon maintains:
- `spec_capabilities` — `id, project_id, capability (path id), title, requirement_count, body_hash, path, last_archived_change, updated_at`, from `openspec list --specs --json` and `openspec show <id> --type spec --json` on the primary clone (default branch), refreshed after every fast-forward.
- `spec_requirements` — `id, capability_id, name, text, scenarios_json`, parsed from the same `show --json` output so requirements are searchable and linkable.
- `spec_changes` — `id, project_id, change_name, state (active|archived), ticket_id, archived_as, created_at, archived_at, artifacts_json {proposal, design, tasks, specs}`; active changes are read from the owning worker's worktree branch (paths from `openspec status --all --json` run there), archived ones from `openspec/changes/archive/` on the default branch.
- `spec_change_capabilities` — `change_id, capability_id, delta_kind (added|modified|removed|renamed)`, from each change's `specs/**` deltas, so every capability has a change history and every change lists what it touched.
Full-text search across capabilities, requirements, change artifacts and the knowledge bases (`knowledge_search` FTS5 table).

**Tools.** `ac_spec_list(projectId)`, `ac_spec_get(projectId, capability)`, `ac_spec_search(projectId?, query)`, `ac_spec_change_get(changeName)`. The conductor may query any project (it uses specs to answer "how does X work today" before creating a `question` ticket); a worker only its own project (it also has the files in its worktree, so the tools mainly give it search and history).

**Spec Explorer (UI §21.1, screen 7, and TUI `conductor specs`).** Per project: a capability list with requirement counts and last change; a capability page rendering the spec with its requirements and scenarios, the pending deltas from active changes (highlighted, linked to their tickets), and the change history (archived changes → tickets → PRs); a change page rendering proposal, design, tasks (with progress) and delta specs for active and archived changes; search across specs and knowledge bases; and a **graph view** (capabilities ↔ changes ↔ tickets as a node network, filterable by time and status) for seeing how a project's spec surface evolved. Knowledge and Specs live under one "Knowledge" section in the UI with a shared search box.

**Boundaries.** Specs are read-only in the UI; they change only through tickets (propose/apply/archive). The index never writes into a repo. Isolation holds: a worker's spec tools are scoped to its project.

### 12.6 Planning rules (skill `agent-conductor-planning`)

Minimize the ticket graph: one end-to-end ticket with one owner by default. Split only for: different owner/project, parallelizable self-contained deliverable, hard dependency needing its own blocker lifecycle, independent review gate, substantial follow-up. Merge-back pass. Every child ticket names its qualifying reason. Scope creep during apply is surfaced with `ac_ask`, never silently absorbed or dropped.

### Implementation notes

Modules: `core/tickets/{service,transitions,guards,checkout}.ts`, `core/openspec/{cli,binding,sync}.ts`, `core/decisions/service.ts`. Tests: transition table exhaustive test; OpenSpec adapter tested against a real `openspec` binary in CI (pinned) using a temp git repo fixture; approval supersession test (new plan revision expires the old decision).

---

## 13. Knowledge bases

Two knowledge bases, both markdown, both budgeted, both curated. They are the memory between sessions: the conductor's across turns and restarts, the workers' across tickets. Nothing else carries context between sessions except the repo itself and the ticket record.

### 13.1 Files, audiences, budgets

Budgets are workspace settings: `defaults.knowledgeBudgetTokens` in `workspace.yaml`, one key per hub file plus `document`, editable from Settings → Workspace and `conductor workspace set-default`. The configured value is what the daemon enforces, reports and triggers curation on; the column `knowledge_files.budget_tokens` mirrors it. The numbers below are the defaults.

| File | Audience | Written by | Budget (tokens) | Content |
|---|---|---|---|---|
| `knowledge/workspace/WORKSPACE.md` | conductor only | human (bootstrap interview) + conductor (`ac_knowledge_note`) | 10000 | what the business is, goals, people and how the human likes to work, the project portfolio (one line per project: id, purpose, default role), cross-project conventions and policies, standing instructions |
| `knowledge/workspace/SHARED.md` | every agent | conductor | 2000 | the project-agnostic subset: house conventions (commit style, PR etiquette, testing expectations), glossary, tone. **Never names projects**, so a worker learns nothing about the portfolio from it |
| `knowledge/workspace/decisions.md` | conductor | daemon (answered decisions marked durable) | 4000 | one line per durable decision with date and ticket; older lines are archived by curation |
| `knowledge/projects/<id>/PROJECT.md` | that project's workers and the conductor | workers (`ac_knowledge_note`), conductor (curation, focus updates), human | 10000 | sections: **Overview** (what it is, who uses it), **Stack & commands** (run, test, lint, build), **Conventions** (project-specific rules the repo docs do not state), **Current focus** (what is being worked toward this month), **Landmines** (things that bite), **Learnings** (dated, concise, perishable entries from workers) |
| `*/archive/` | nobody by default | curation | none | pruned entries with date, author and reason; grep-able, never injected |

The repo's own `AGENTS.md`/`CLAUDE.md`, docs and OpenSpec specs remain the committed contributor knowledge; workers read them from the worktree and change them through PRs like any contributor. The OpenSpec specs are additionally indexed and explorable next to the knowledge bases (§12.5); the project KB should point at capabilities rather than restate them. The project KB holds what is *about* working on this project from the outside and what is not yet (or should not be) in the repo.

### 13.2 What each agent sees at bootstrap

| Agent | Injected on first turn / reset | Reachable on demand |
|---|---|---|
| Conductor | WORKSPACE.md, SHARED.md, decisions.md (last 30 lines), the Overview + Current focus of every PROJECT.md | any project KB in full, tickets, roles |
| Worker | SHARED.md, its own PROJECT.md in full, its brief, the ticket's documents | its ticket's comments, its worktree, OpenSpec artifacts |

A worker's run token cannot fetch anything outside that set: other projects' KBs, tickets, worktrees, and `WORKSPACE.md` return `403`. The turn prompt never mentions other projects. The conductor, by contrast, is expected to hold a working model of every project; that is why its bootstrap includes each project's Overview and Focus and why its prompt lists the portfolio.

### 13.3 Writing rules (in skills, enforced by the daemon)

- Entries are **concise** (≤ 60 words), **standalone** (no pronouns, absolute dates), **durable** (not task state, not anything derivable from git or the repo, never secrets), and written for the next reader who has no other context.
- Workers write only to the project KB, only through `ac_knowledge_note`, typically at most once per ticket, usually in the merge turn ("what would I have wanted to know before starting this ticket?"). The daemon rejects near-duplicates, over-length entries, and over-budget writes (returning the current size and the sections that are over).
- The conductor writes to the workspace KB the same way (how the human works, standing preferences, cross-project conventions) and may edit **Current focus** in any project KB.
- The human may edit any file directly; the daemon re-indexes on change and re-checks budgets.
- Perishable entries carry `<!--exp:YYYY-MM-DD-->`; expired entries are archived automatically.

### 13.4 Curation (so files never grow without bound)

Curation is a scheduled, agent-performed rewrite of one knowledge file, run by the daemon:

- **Triggers**: a file crosses 80 % of its budget; or 14 days since its last curation; or `conductor knowledge curate <file>`; or an over-budget write was rejected.
- **Who**: workspace files are curated by the conductor in a dedicated turn (`system` wake, reason `curate`). A project KB is curated by a **curation worker**: a worker spawned from the project's default role for an auto-created `task` ticket "Curate project knowledge" with `noWorktree: true` (cwd = worker home, read-only checkout of the primary clone exposed as `work/` for fact-checking). It runs on the role's runtime with a fresh session, costs one turn, and retires when the ticket is `done`.
- **What the curator does** (skill `agent-conductor-knowledge`): merge duplicates, fold learnings that have become conventions into the right section, delete or archive entries that are stale, contradicted by the repo, or now stated in the repo docs, tighten wording, keep every section within its share of the budget. It produces the new file with `ac_knowledge_replace`; the daemon diffs it, archives every removed entry with provenance, and records the diff on the curation ticket so the human can review or revert (`conductor knowledge revert <file> <revision>`).
- **Guarantees**: a curated file is always at or under budget; nothing is deleted without an archive copy; curation never invents facts (the skill forbids adding entries; it may only merge, move, tighten or remove); `conductor knowledge lint` reports sizes, last-curated dates and pending triggers.

### 13.5 Bootstrap digest

On a worker's first turn (and on a conductor session reset or staleness), the turn prompt includes the injected set from §13.2 plus a five-line reminder of the status protocol. The total is measured and logged as `bootstrap_tokens`; the hard cap is `bootstrapBudgetTokens` (default 16000) and, because every file is itself budgeted, the cap is normally not reached. If it is, project KB **Learnings** are truncated first with an explicit "truncated, call ac_knowledge_get" line; never the brief, SHARED.md or the rules.

---

## 14. Channels

### 14.1 Interface (`packages/channel-sdk`)

```ts
export interface ChannelAdapter {
  readonly kind: string;                       // "web" | "cli" | "telegram" | plugin kinds
  readonly capabilities: ChannelCapabilities;  // { supportsButtons, supportsMarkdown, supportsEdit, supportsThreads, supportsFiles, maxTextBytes }
  configSchema(): JsonSchema;
  validateConfig(config: unknown): ValidationResult;
  start(ctx: ChannelContext): Promise<RunningChannel>;   // ctx.inbound(message), ctx.log; returns { stop() }
  send(msg: OutboundMessage): Promise<SendResult>;      // { externalMessageId?, delivered: boolean, error?: {code, retryable} }
  renderDecision?(decision: DecisionView): CanonicalMessage;   // default renderer used when absent
  handleWebhook?(req): Promise<WebhookResult>;
}
```

- `CanonicalMessage` parts: `text | mention | file | card { title, body, actions[] } | quote`. A pure `degrade(message, capabilities)` turns cards into text with numbered options and a reply syntax (`/d <decisionId> <optionKey>` or a plain reply quoted to the message).
- Module top level may only construct and register (`registerChannel`); a contract test imports every channel package and asserts no IO at import.
- Errors: `RetryableChannelError` vs `PermanentChannelError` (stable codes). Outbound delivery is a queue with per-message attempts recorded on `thread_messages`.

### 14.2 Routing

- **First contact binds.** An inbound external conversation (Telegram chat id) binds to a `channel_thread` for the conductor. `/talk <ticket>` (or a UI action) binds the thread to that ticket: messages become ticket comments and wake the ticket's live worker (§11.7); `/conductor` unbinds. Unknown senders are ignored unless in `allowedUserIds` (Telegram) — never auto-onboard.
- Inbound message → `thread_messages` row → `enqueueWakeup(agent, {source: human_message, payload: {threadId, messageId}})`.
- Outbound: the conductor only through `ac_human_send`; workers only through ticket comments, which the daemon relays to bound threads. A run's plain final text is stored on the run but not sent; the charters say so explicitly.
- Decisions owned by the human are pushed to the human's **primary thread** (the most recently active thread, or the one configured as `notify`) as a card; answering on any channel resolves the decision everywhere (idempotent by decision id; late clicks return "already answered").
- Typing indicators / "working…" acks: the daemon sends a short acknowledgement when a human message arrives and the agent is busy or the queue is deep (> 20 s), so the human is never left in silence (firstmate's ack → act → follow up).

### 14.3 Built-in channels

- `web`: SSE stream + POST endpoint used by the UI (§21).
- `cli`: `conductor chat [agentId]` interactive REPL over the HTTP API; `conductor say "<text>"` one-shot.
- `telegram`: long polling (no public URL needed), inline keyboard buttons for decisions, markdown v2 rendering with fallback, file uploads for reports. The **only** external channel in v1; WhatsApp/Discord/Slack are plugin work that the interface must make trivial (contract test + `channels/telegram` as the reference implementation).

---

## 14b. Presentation surfaces (herdr, Hyprland, tmux, terminal, web)

Execution never changes: every agent turn is a daemon-spawned headless process with a JSON event stream (§7–§8). A **surface** decides where that agent is *shown* and how a human attaches to it. Surfaces are plugins (`packages/surface-sdk`) that run inside the **presenter** (`conductor presenter`, a small client-side process on the machine whose screen you are looking at; §4.4), configured per workspace under `presentation:` (§5), switchable at runtime (`conductor presentation set workers.surface hyprland`), and always additive: the web UI and the run log work regardless of the chosen surface. The daemon stores the desired config and streams worker lifecycle events; the presenter reconciles windows locally and reports handles back. Several presenters can run at once (a laptop and a desktop) with their own surface each.

### 14b.1 The attach TUI (`conductor attach`)

`conductor attach <agentId>` (package `tui`, Ink) is the universal terminal view of one agent (the conductor or a worker): a live transcript rendered from `run_events` (assistant text, tool calls with collapsed results, file changes, status lines), a status bar (worker name and role, ticket, runtime, model, turn count, worktree state, spend so far), and an input line. Text typed there is a direct-thread message to that agent (`human_message` wake) and, when the agent is mid-turn, it is queued and delivered as the next wake (the TUI says so). Keybindings: pause/resume, open ticket, jump to worktree in `$SHELL`, cancel run, relaunch. `conductor chat` is the same component pointed at the conductor with chat-first layout (§21.3); on a worker, the input line posts ticket comments (§11.7). `conductor top` is a one-screen fleet view (workers grouped by project and role × status × ticket × spend) with the same keys.

This means every surface is just "open a terminal running `conductor attach <id>`" in the right place.

### 14b.2 Interface

```ts
export interface SurfaceAdapter {
  readonly kind: string;                              // "headless" | "tmux" | "herdr" | "hyprland" | plugin
  detect(): Promise<{ available: boolean; notes?: string }>;   // e.g. HYPRLAND_INSTANCE_SIGNATURE set, herdr socket reachable
  configSchema(): JsonSchema;
  ensureAgentView(agent: AgentView, cfg: unknown): Promise<SurfaceHandle>;   // create or reuse the window/pane/tab for this agent
  updateAgentView(handle: SurfaceHandle, state: AgentPresence): Promise<void>; // title/status changes (idle/working/blocked/done)
  focusAgentView(handle: SurfaceHandle): Promise<void>;
  closeAgentView(handle: SurfaceHandle, reason: "retired" | "presentation_changed"): Promise<void>;
  ensureConductorView?(cfg: unknown): Promise<SurfaceHandle>;
  layout?(handles: SurfaceHandle[], cfg: unknown): Promise<void>;           // arrange (grid, per-project grouping)
}
```

The presenter calls `ensureAgentView` when a worker is spawned (or the presentation config changes), `updateAgentView` on status transitions (so window titles and herdr/tmux pane names reflect `working / idle / blocked / needs you / merging`), and `closeAgentView` when the worker is retired. Windows come and go with tickets, which is the natural "what is happening right now" view; a `keepClosedFor` grace (default 2 min) lets the human read a finished worker's last screen. Handles are persisted per presenter (`surface_handles` table: presenter_id, agent_id, surface_kind, handle_json) and re-verified on presenter start; a missing window is recreated, never duplicated. Surface failures are logged and never block a run.

### 14b.3 Built-in surfaces

- **headless** (default): no-op; monitoring via web UI or ad-hoc `conductor attach`.
- **tmux**: one tmux session per workspace (`ac-<workspace>`), one window per live worker running `conductor attach <id>`, window name = role + ticket + status glyph; conductor in window 0 running `conductor chat`. `conductor presentation open` attaches the human's terminal to the session.
- **herdr** (Omarchy/Hyprland users already run it; the herdr CLI is socket-driven): one herdr workspace per AgentConductor workspace (`herdr workspace create --cwd <ws> --label <name>`), one tab per project (`herdr tab create --label <project>`), one pane per live worker (`herdr pane split ... --no-focus` then `herdr pane run <pane> "conductor attach <id>"`), conductor in the first tab's root pane running `conductor chat`. Handles store herdr ids but, because herdr ids compact when panes close, the adapter re-resolves by pane title/command on every reconcile rather than trusting stored ids. The adapter reads `herdr pane list` to detect the human closed a pane and does not fight it (recreate only on explicit `conductor presentation reconcile`). Optional: mirror herdr's own `agent_status` (it detects idle/working/blocked from the pane) into the UI as a secondary signal.
- **hyprland**: each live worker gets its own terminal window on a chosen Hyprland workspace. **The adapter never touches any Hyprland config file.** Everything goes through `hyprctl` at runtime: window rules with `hyprctl keyword windowrule "workspace <n> silent, class:^(ac-<workspace>-.*)$"` (rule syntax per the installed Hyprland version; verified by `detect()` and re-applied on daemon start and on every reconcile, since keyword rules are not persisted), windows with `hyprctl dispatch exec "[workspace <n> silent] <terminal> --class ac-<workspace>-<agentId> -e conductor attach <agentId>"`, focus with `hyprctl dispatch focuswindow class:^(ac-<workspace>-<agentId>)$`, and state queries with `hyprctl clients -j` (so a window the human closed is noticed, not fought). Layout: Hyprland's tiling gives the grid for free; `layout: grid` issues `hyprctl dispatch layoutmsg` calls to balance; `layout: per-project` groups windows with `hyprctl dispatch togglegroup`. Titles come from the terminal's OSC title, which `conductor attach` sets (`<role> #<n> · <ticket> · <status>`). The conductor can live in a terminal on the human's current workspace (`conductor: { surface: terminal }` opens `conductor chat` in a new terminal window with no workspace rule). `conductor doctor` prints the equivalent rule lines for humans who prefer a persistent rule in their own config, but the daemon never writes them.
- **terminal** (conductor only): spawn the terminal running `conductor chat`; used by the `conductor:` block.
- **Terminal resolution** (all terminal-spawning surfaces): `presentation.<block>.terminal` if set, else the system default: `$TERMINAL`, else `xdg-terminal-exec` when present, else fail with a clear message asking for one of the two. No hard-coded emulator list; foot, kitty, ghostty, alacritty all work because the adapter only needs `--class`/`--app-id` and `-e` (a small per-emulator arg table covers the flag spelling, detected from the binary name).

### 14b.4 Interactive escape hatch (M6, approved)

Some power users will want the real CLI TUI for a worker (to use slash commands, watch permission prompts). Claude Code now supports background sessions (`claude --bg` → id; `claude attach <id>` opens the live session in a terminal; `claude logs`), which would let the daemon run an agent's turns in the background and a surface open `claude attach` instead of `conductor attach`. Whether events and structured results can still be captured in that mode is unverified; it is an approved M6 spike (`interactive: true` per role on the Claude runtime): the daemon runs the worker's turns with `claude --bg` and the surface opens `claude attach <id>` instead of `conductor attach`, falling back to `conductor attach` when the capture contract cannot be met. Written up as an ADR either way. Until then, `conductor attach` is the only interactive view.

### Implementation notes

`surface-sdk` ships a contract test (adapter must be side-effect-free at import, idempotent `ensureAgentView`, tolerant of externally closed views). `surfaces/tmux` is the reference implementation and CI-testable; herdr and hyprland adapters are tested with recorded CLI fixtures plus a manual checklist in `docs/demos/`.

---

## 15. Decisions, approvals, human-in-the-loop

A **decision** is the single primitive for: plan approval, merge approval, hire approval, agent questions (`ac_ask`), gate findings, and conductor questions to the human. Properties: one owner, options with a recommendation, free-text allowed, expiry, correlation key, target (document revision or spec revision) for supersession, verbatim answer text recorded.

Ownership policy (`workspace.yaml` defaults, overridable per project): `plan_approval: human`, `merge_approval: human` (not overridable; only a ticket's `auto_merge` flag bypasses it), `hire_approval: human`, `gate_finding: conductor` (the conductor decides unambiguous findings toward the accepted design and escalates contract expansions, product calls, destructive or security-sensitive choices — firstmate's ask-user-authority rule, in the conductor prompt).

Presentation to the human: one decision per message, containing what it is, why now, the real options, the recommendation with a one-line why. Batching unrelated decisions into one list is forbidden in the conductor prompt. Answer forms: button (channels with cards), `/d <id> <key>` reply, or natural language in the thread that the conductor maps to `ac_decision_answer` **only when it owns the decision**; human-owned decisions answered in natural language are matched by the conductor and confirmed with a one-line echo ("Recorded: approve plan for ACME-42").

CLI intercepts: when a runtime surfaces a native ask (Claude `AskUserQuestion`, `ExitPlanMode`), the runtime adapter converts it into a `user_input.requested` event; the engine creates a decision and, because headless CLIs cannot block on an answer indefinitely, the adapter answers the CLI with a canned "This question was forwarded to the human as decision D-n; stop working on this item and end your turn" so the run ends cleanly. The answer arrives as the next wake.

`decisions.md` in `knowledge/` receives a one-line append per answered decision of kind `plan_approval|merge_approval|hire_approval|question` when the answer sets `remember: true` or the conductor marks it durable.

---

## 16. Telemetry, usage, analytics

Three named data paths (paperclip's rule, adopted verbatim): **run log** (local DB + files, no review), **observability** (OTLP traces, off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set), **telemetry** (does not exist; there is no phone-home).

**Budgets are out of scope for v1.** AgentConductor collects usage and shows it; it never blocks work because of spend. Budget policies, hard stops and override decisions are a later feature and must be designed so they attach to the usage model below without changing it.

### 16.1 Run log

`run_events` (closed enum §8.2 plus engine events `run.phase.timing`, `run.started`, `run.finalized`, `supervisor.action`) with monotonic `seq`, redaction on write (`AC_RUN_TOKEN`, known secret env values, `Authorization:` headers, inline base64 blobs), payload bound 8 KB, raw stream on disk with retention `runLogRetentionDays` (default 30; DB rows kept, files pruned).

### 16.2 Usage collection

One `usage_events` row per run (or per usage delta for `session_cumulative` runtimes, where the engine deltas against the session's stored cumulative usage): tokens in/out/cached, model, provider, duration, and cost when known. Cost: runtime-reported when available (Claude reports `total_cost_usd`); otherwise a pricing table in `shared/src/pricing.ts` (model → per-token rates, versioned, editable in `workspace.yaml` `pricingOverrides`) with `cost_status=estimated`; unknown model → `unpriced` with tokens still recorded (tokens are the primary metric; dollars are derived and always labelled reported/estimated). `billing_type` from the runtime's auth mode (subscription vs API key) when detectable, else `unknown`. Attribution fan-out on every row: workspace, project, role, worker, ticket, run, runtime, model.

### 16.3 Analytics (what the UI surfaces)

Every query is answered from `usage_events` with the same shape: a **scope** (workspace, project, role, ticket incl. subtree, worker, model, runtime) × a **window** (last 24 h, today, yesterday, this week, last 7 days, this month, custom range, all time) × a **grain** (hour, day, week) → series of `{ tokensIn, tokensOut, tokensCached, runs, workerTurns, durationMs, costCents, costStatus }` plus a total. Comparisons against the previous window are computed server-side.

Views the UI builds on it: workspace usage over time; per-project usage (and per-project share of the workspace); per-ticket cost including subtree rollup and a per-turn breakdown; per-model usage (tokens and cost by model, model mix over time, which projects/roles use which model); per-role and per-worker; runs per hour/day with success and recovered counts. Windows and grains are shared constants (`shared/src/usage-windows.ts`) so the TUI, the CLI (`conductor usage`) and the web agree.

API: `GET /api/w/<ws>/usage?scope=project:api&window=7d&grain=day`, `GET …/usage/top?by=model|ticket|role&window=24h`, `GET …/usage/ticket/<id>` (subtree + turns), `GET …/usage/models?window=month`. Materialized daily rollups (`usage_daily`) keep month-scale queries fast; hour grain reads raw rows.

### 16.4 Analytics API

`GET /api/analytics/summary?window=month` (spend, tokens, runs, success rate with retry-aware "recovered" count, decisions pending, tickets by status, workers live/spawned/retired), `by-role`, `by-worker`, `by-project`, `by-ticket/<id>` (subtree rollup: cost, tokens, runs, wall time), `by-model`, `runs?agent=&status=`, `run/<id>/events`. The UI's dashboard is built on these only.

### 16.5 Observability

OpenTelemetry traces per run (span per phase) and per HTTP request; `trace_id` in every log line; exporter env-configured, no-op otherwise. Logging domains (closed enum): `daemon, wake, run, runtime, ticket, openspec, decision, channel, knowledge, cost, budget, plugin, http`.

---

## 17. Extension points

All extension goes through `packages/plugin-sdk`:

```ts
export interface AgentConductorPlugin {
  id: string; version: string; apiVersion: 1;
  register(host: PluginHost): void | Promise<void>;
}
export interface PluginHost {
  registerRuntime(adapter: RuntimeAdapter): void;
  registerChannel(adapter: ChannelAdapter): void;
  registerSurface(adapter: SurfaceAdapter): void;
  registerHook(subscription: { events: EventType[] | "*"; handler: (ev: WorkspaceEvent) => Promise<void> }): void;
  registerAgentTool(tool: AgentToolDefinition): void;   // extra ac_* MCP tools with scope: conductor | worker | all
  registerWorktreeProvider(provider: WorktreeProvider): void;   // §11.5
  registerForge(adapter: ForgeAdapter): void;           // PR/merge operations (github via gh is built in)
  registerStorage?(provider: LogStorageProvider): void;
  config<T>(schema: ZodType<T>): T;                     // plugin config from workspace.yaml plugins[].config
  logger: Logger; api: ControlPlaneClient;              // typed client over the REST API with a service token
}
```

- Plugins are npm packages or local directories listed in `workspace.yaml`; loaded in-process at daemon start (trusted code; documented as such). Out-of-process isolation is a non-goal for v1.
- **Webhooks**: `workspace.yaml` `webhooks: [{url, events, secret}]` → the daemon POSTs events (HMAC-SHA256 signed, at-least-once, from the `events` outbox with a per-webhook cursor).
- **Inbound HTTP**: `POST /api/tickets` etc. with a human or service token; `POST /api/routines/<publicId>/fire` for external triggers (M6).
- **SSE**: `GET /api/events?after=<seq>` for any UI or integration.
- **Non-goals for plugins** (enforced by not exposing the APIs): overriding checkout/transition guards, approval ownership, the auto-merge gate, or the project boundary.
- REST is fully described by an OpenAPI document generated from the Zod route schemas (`GET /api/openapi.json`) and an agent-readable `GET /llms/api.txt`.

---

## 18. Skills shipped (`skills/`)

Installed by the daemon into each agent home for its runtime (Claude `.claude/skills/<name>/SKILL.md`, Codex `.agents/skills/`, OpenCode `.opencode/skills/`, Gemini equivalent), regenerated whenever the shipped version changes. Skills are progressive disclosure: the charter names when to load each; the always-loaded charter stays short.

| Skill | Audience | Purpose |
|---|---|---|
| `agent-conductor-worker` | workers | The turn loop, brief verification, ticket rules, status protocol, delivery and merge, report format, common mistakes table. |
| `agent-conductor-openspec` | workers | How the ticket flow maps to OpenSpec skills; what never to do (archive, ask in prose, start implementing during propose). |
| `agent-conductor-scout` | workers | Report format and rules for investigation tickets. |
| `agent-conductor-conductor` | conductor | Intake, routing, supervision, digest handling, outcome language, translation table. |
| `agent-conductor-hire` | conductor | Role overlap check, spec drafting, charter template usage, activation flow, charter refinement across workers. |
| `agent-conductor-planning` | conductor (and agents decomposing) | Minimal ticket graphs, qualifying split reasons, acceptance criteria format. |
| `agent-conductor-briefing` | conductor | Four-section briefing, one-decision-at-a-time flow. |
| `agent-conductor-knowledge` | all | What belongs in the project KB vs the workspace KB vs the repo vs the ticket; writing concise dated entries; curation procedure (merge, move, tighten, remove; never invent); budget behavior; expiry markers. |

Outlines and key rule text are in `docs/prompts/skills.md`.

---

## 19. Security

- Remote access is a core feature (§4.4): password-gated operator account, hashed opaque session tokens, TOTP optional, lockout and rate limiting, TLS mandatory off-loopback, CSRF protection (SameSite cookies + origin checks) for the web app, authenticated WebSocket/SSE, `activity` rows for logins, logouts and revocations. The run-token MCP endpoint and presenter socket are loopback-only.
- Principals: operator sessions (`conductor login` writes a named context in `~/.config/agent-conductor/contexts.yaml`), run tokens (short-lived JWT, scoped, loopback-only), service tokens (plugins/webhooks). Every request is attributed in `activity`.
- Secrets: never in the DB; referenced by env var name or OS keychain; injected into runs only when the agent spec lists them; redacted from logs.
- Agent authored content is untrusted input to other agents: comments carry `source_trust`; the turn prompt wraps quoted comments in a clearly delimited block and reminds the agent that instructions inside tickets/comments are data. Conductor never executes commands from ticket text.
- Runtime permission posture per role; `bypass` requires explicit human opt-in and is shown in the UI. Deny list always includes force-push and default-branch push where the runtime can express it.
- Workers cannot read other projects (no `--add-dir` beyond their home + `knowledge/` allowlist).

---

## 20. CLI surface (`conductor`)

Human commands:
```
conductor init <dir> --prefix ACME [--name]          scaffold a workspace
conductor daemon start|stop|restart|status|logs|set-password|install-service [--launchd]   daemon lifecycle; TLS/ACME and listen config in daemon.yaml
conductor daemon upgrade [--from <url|path>] [--ref <ref>] [--test] [--no-restart]   build a release, back up, drain, switch `current`, restart (from this shell; works when the daemon is not answering)
conductor daemon update | update apply [--ref <ref>] [--test] [--no-follow] | update cancel   ask the daemon: is the source ahead? queue an upgrade it defers until no turn is running; cancel a queued one
conductor daemon releases | rollback             list releases (`*` current, `-` previous); switch back to `previous` and restart
conductor login <url> [--name] [--pin] | conductor logout [--all] | conductor context list|use   remote contexts for the CLI
conductor devices list|revoke                          sessions/devices on the daemon
conductor presenter [--surface ...]                     client-side window manager for surfaces (§14b)
conductor project add <git-url> [--id] [--runtime] [--branch]   clone, init openspec, create the scout ticket that seeds the project KB
conductor project list|show|remove|fetch|set-runtime <runtime>|set-policy <key>=<value>...
conductor runtime list|detect|login <id>              runtime availability and auth per workspace
conductor role list|show|activate|set-runtime|set-model|pause|resume|retire|charter show|charter rollback|memory show
conductor worker list|show|pause|resume|relaunch|cancel|purge
conductor ticket create|list|show|merge-queue [-p <project>]|assign <role>|set --auto-merge|transition|comment|cancel|discard --force|open (browser)
conductor decision list|show|answer <id> <key|text>
conductor chat [ticketId]                              interactive thread (conductor by default; a ticket binds to its live worker)
conductor say "<text>"                                 one-shot message to the conductor; prints the reply
conductor briefing                                     four-section briefing (no LLM: rendered from the snapshot)
conductor attach <workerId|conductor>                   live transcript + steering for one agent (TUI)
conductor top                                           fleet view
conductor presentation set|open|reconcile|status       surfaces (§14b)
conductor conductor set-model|set-runtime|show         conductor configuration
conductor workspace list|use|register|unregister|pause|resume   multi-workspace registry
conductor workspace set-default <key=value...>         workspace defaults, e.g. knowledgeBudgetTokens.project=20000
conductor runs list|show|tail <runId>|cancel
conductor usage [--scope workspace|project:<id>|ticket:<id>|role:<id>|model:<id>] [--window 24h|today|7d|week|month|all] [--grain hour|day|week]
conductor knowledge show|edit|note|lint|curate|revert   knowledge bases: sizes, budgets, last curation, curation history
conductor specs list|show <capability>|changes|search   the spec index (TUI explorer with `conductor specs`)
conductor worktree list|verify|discard                 provider-managed worktrees and landed-work verdicts
conductor workspace export [--out <dir>] | import <dir> --target <dir>   portable package (role specs, charters, knowledge, tickets as markdown, no secrets)
conductor doctor [--install] [--yes]                    checks: runtimes, git, gh, openspec, worktrunk, db, permissions; --install offers no-root installs
```
Agent commands (run-token scoped): §9.5.

---

## 21. Front ends

Two front doors, same product quality, same data: the **web app** and the **terminal (`conductor` TUI)**. Both are thin clients over the REST + SSE API; neither embeds business logic. Design goal: the human should prefer talking to the conductor here over opening any CLI directly, and should be able to watch any agent think without reading raw logs.

### 21.1 Web app (`packages/ui`)

Stack: React 19 + Vite + TypeScript, TanStack Query + Router, Tailwind v4 with a small component layer (shadcn-style primitives, no heavy UI kit), streaming via SSE (`/api/w/<ws>/events`) with optimistic updates, keyboard-first on desktop (command palette `⌘K`, vim-style list navigation), light/dark. **Mobile is a first-class target, not a breakpoint afterthought**: installable PWA, bottom navigation on phones, thumb-reachable primary actions (Start Work, approve/revise cards), swipe between ticket tabs, decision cards designed for one-hand use, push notifications for decisions and landed work (via the web channel), and voice dictation on both phone and desktop. Served by the daemon.

Information architecture (left rail):
1. **Chat** (default view). A persistent **Start Work** action (button on desktop, bottom bar on mobile, shortcut `⌘⇧Space`) opens the composer focused, with a **microphone** toggle for voice dictation (Web Speech API where available, else streamed to the daemon's transcription endpoint which delegates to a configured provider; push-to-talk with the same shortcut held, tap-to-toggle on mobile; live transcript editable before sending). The same composer is used everywhere the human writes: chat, ticket comments, decision notes, revise-plan notes. Conductor thread with streamed replies, inline **decision cards** (approve/revise/reject with a note; plan cards render the proposal and tasks with diff-style highlighting of revisions), ticket chips that expand inline, worker chips with live status, slash commands (`/talk <ticket>`, `/ticket`, `/brief`), message search. A bound ticket thread opens as a secondary tab showing the ticket's comment stream with the worker. Typing/working indicators driven by run events ("Backend Engineer #7 is running tests…" from `tool.call` events).
2. **Board**: tickets by project as kanban (status columns of §6.2) and as list/table with filters (project, agent, kind, priority, blocked-on-me). Ticket page: description, plan document with revision history and inline approve, comments (agent/human/system, run-attributed), work products (PR with live CI state), OpenSpec progress (tasks ticked), blockers graph, runs and cost for this ticket (subtree rollup), worktree state.
3. **Team**: org view (conductor → projects → roles → live workers); roles with status, runtime/model (dropdown from `listModels()`), max workers, spend, charter with revision history and rollback, pause/resume/retire; workers as live cards (ticket, phase, worktree state, last status line, spend) opening a worker page with the **live transcript** (same renderer as `conductor attach`: assistant text, tool calls collapsed, file diffs, status lines), brief, steering input (posts a ticket comment), relaunch/cancel.
4. **Decisions** inbox: everything waiting on the human, one card per decision, answer inline; also the conductor-owned ones for transparency.
5. **Runs**: timeline of runs across workers with filters; run page = transcript + phase timings + usage + cost + raw event download.
6. **Usage**: tokens and cost by workspace, project, role, worker, ticket (with subtree rollup) and model over selectable windows (24 h, today, week, month, custom) and grains (hour, day, week); model mix over time; run success with recovered count; a per-ticket turn breakdown. Cost is always labelled reported or estimated, tokens are the headline.
7. **Knowledge & Specs**: one section, one search box. Knowledge: workspace KB and each project KB as readable markdown with a size/budget meter, last-curated date, revision history and revert, a "curate now" action. Specs (§12.5): per project a capability list, capability pages (requirements and scenarios, pending deltas from active changes linked to tickets, change history to tickets and PRs), change pages (proposal, design, tasks with progress, delta specs; active and archived), and a graph view of capabilities ↔ changes ↔ tickets over time. Read-only.
8. **Settings**: workspace (name, prefix, defaults, policies), projects (add/remove, runtime, max workers, setup command, worktree provider, OpenSpec pin), conductor (runtime, model dropdown, channels), channels (Telegram config, allowlist), presentation (surface selection with detection status), budgets, plugins, workspace switcher (multi-workspace).

**Design contract.** The Claude Design mockup (`docs/design/mockup/AgentConductor Spec.dc.html`) is the source of visual truth; its tokens, components, screens, states and the designer's calls are transcribed in `docs/design/DESIGN-CONTRACT.md`, which this section defers to wherever they differ. The language below is the brief that produced it.

**Design language: Linear-grade.** The reference for UI and UX is Linear (the issue tracker): fast, calm, keyboard-first, information-dense without clutter, with light and dark modes as equals. Not a copy of Linear's brand; its *standards*:
- Layout: a slim left sidebar (workspace switcher, navigation, projects), a list-or-board main pane, a details pane that slides in for the selected item; on phone the same content as stacked views with a bottom bar. Everything reachable in two keystrokes on desktop and two taps on phone.
- Type: one clean sans (Inter or system UI stack) at a tight, consistent scale; monospace only for machine values (ids, tokens, timestamps, code). Tabular numerals.
- Surfaces: subtle 1 px borders and very light elevation, small radii (4–6 px), no heavy shadows or gradients. Hierarchy through spacing, weight and colour, not boxes.
- Colour: neutral greys with one accent, plus the systematic status set (`idle / working / blocked / needs-you / merging / done / failed / paused / stalled`) rendered as Linear-style status glyphs (ring/progress icons) and colour tokens used identically in badges, rows, cards, window titles, TUI and charts. Both themes from tokens; the dark theme is designed, not inverted.
- Interaction: instant optimistic updates, streamed text, a `⌘K` command palette that does everything (create ticket, jump, filter, change status, switch workspace), keyboard shortcuts on every list (j/k, enter, `c` to create, `a` to assign…), inline editing, hover actions that are also reachable by keyboard. Micro-interactions are quick (≤ 150 ms) and honour reduced-motion.
- Density: lists show many rows with clear scan lines; details never hide behind extra clicks that a hover or a keystroke could reveal. Empty states are short and actionable.
- Tokens are the only source of visual values (`ui/src/index.css`, Tailwind v4 `@theme`; a lint gate rejects hex, raw px and arbitrary values in components). Motion tokens with a `prefers-reduced-motion` collapse. The UI is agent-modifiable: a restyle is "edit tokens, run checks".
- The TUI (§21.2) shares the status set, glyph semantics and layout logic with the web, so switching between them feels like one product.

Quality bar: no spinner-only states (skeletons with real structure), every list virtualized, every long text collapsible, all actions reversible where the domain allows, errors shown with the daemon's typed code and a next step. Accessibility: full keyboard operation, ARIA on cards, reduced-motion respected. Reviewed with the human at M4 against a small set of reference screens (chat with cards, board, worker page) before the rest is built out.

### 21.2 Terminal (`packages/tui`, Ink)

`conductor chat` (conductor), `conductor attach <agent>`, `conductor top`, plus non-interactive `conductor say` and `conductor briefing`. Same renderer for transcripts and decision cards as the web (shared `@agent-conductor/render` package that turns run events and decisions into a view model; web and TUI only differ in the widget layer). Decision cards in the TUI render options as numbered choices; answering is `1`/`2` or free text. Mouse optional. Works over SSH. This is what the Hyprland/herdr/tmux surfaces (§14b) place in windows.

### 21.3 Shared render package

`packages/render`: pure functions `runEventsToTranscript(events) → TranscriptBlock[]`, `decisionToCard(decision) → CardModel`, `ticketToSummary`, `briefingToSections`. Golden-tested. Prevents the web and TUI from drifting and keeps the transcript semantics (collapsing repeated tool status updates into one card, redaction) in one place.

---

## 22. Milestones and acceptance criteria

Each milestone ends with a demo script in `docs/demos/M<n>.md` that the implementer runs end to end. Front-end work is a track that runs alongside the backend milestones (the "UI" bullet in each).

**M0 — Scaffold (1–2 days)**
- pnpm monorepo, packages stubbed, shared enums/Zod, Drizzle schema + first migration for all §6 tables, guard scripts, CI (lint, typecheck, unit tests), `packages/render` skeleton.
- Accept: `pnpm test` green; `conductor init` creates the §5 layout; JSON Schemas for `workspace.yaml` and `agent.yaml` generated and validated; daemon registers two workspaces and serves `/api/w/<id>/health` for both.

**M1 — Conductor you can talk to (core loop)**
- Operator password, session tokens, `conductor login`/contexts, authenticated public listener with self-signed TLS, loopback listener for run tokens; the whole milestone is demoed from a second machine.
- Multi-workspace daemon with wake queue, dispatcher, run engine, supervisor (silence + timeout), sessions (persistent policy), Claude runtime adapter (headless + resume + stream-json parser + structured report + `listModels`), MCP endpoint with the common + conductor tools, `cli` and `web` channels, tickets service with transitions and guards, decisions service, activity + events outbox, cost events from Claude usage, conductor model selection.
- UI: `conductor chat` TUI with streaming and decision cards; web app shell with Chat view (streaming, cards) and Runs view (live transcript).
- Accept: from a laptop against a daemon on another host, `conductor login` then `conductor say "create a ticket to add a README badge in project api"` → conductor creates the ticket (no roles yet, so it stays `backlog` and the conductor says so). Restart the daemon mid-run → the run is marked interrupted, the wake is retried once, nothing is lost. Turn 2 resumes the session (same session id; the conductor recalls turn 1). Changing the conductor's model in settings takes effect on the next turn.

**M2 — Roles, workers, worktrees, OpenSpec flow, worker-performed merge**
- `conductor project add` (clone, worktree provider setup, `openspec init`, project-KB scout ticket), hiring roles (`ac_role_hire`, spec + charter generation, `pending_activation`, `hire_approval` decision with runtime switch), worker spawn with generated briefs and provider-created worktrees (worktrunk default, git fallback), landed-work removal test, worker tools, OpenSpec adapter, full `change` ticket flow through `proposed → approved → in_progress → in_review → merging → done` with the same worker rebasing/resolving/merging across turns of one session, reconciliation of PR state, archive on the default branch, worker retirement and archive, knowledge bases with budgets and curation workers, stuck-worker relaunch, skills `agent-conductor-worker|openspec|scout|knowledge|hire|planning|conductor`.
- UI: Board + ticket page (plan approval inline), Team view with live worker cards and transcript, `conductor attach`.
- Accept (demo): human asks for a feature → ticket → conductor hires a role → human approves hire → a worker spawns and proposes in its worktree → human approves the plan → the same worker implements, ticks tasks, opens PR → human approves merge → the worker rebases onto a deliberately conflicting main, resolves, merges → daemon archives the change, removes the worktree, retires the worker → ticket `done` → conductor reports. Three tickets assigned to one role run as three concurrent workers in separate worktrees; a fourth waits for a slot and the conductor says so. Killing a worker mid-turn relaunches it with a progress note and it finishes. `conductor ticket discard` on an unlanded worktree refuses without `--force`. The demo passes with both worktree providers.

**M3 — Telegram, surfaces, human-in-the-loop polish**
- Telegram channel (long polling, allowlist, buttons, degrade path), decision cards on all channels, `/talk <ticket>`, busy acknowledgements, conductor digest wakes, briefing skill + `conductor briefing`, decision expiry, `decisions.md`, native ask interception.
- Surfaces: `surface-sdk`, the client-side `conductor presenter`, `headless`, `tmux` (reference), **`hyprland`** and **`herdr`** adapters, `conductor presentation`, `conductor top`; built-in ACME, TOTP, device management, PWA push notifications, remote voice dictation endpoint, `conductor daemon install-service` and the Docker image.
- Accept: the daemon on a VPS with ACME TLS; the M2 demo done from a phone via the PWA and via Telegram, with the laptop closed; then on the Hyprland machine, `presentation.workers.surface=hyprland workspace=5` puts every live worker in its own terminal window on workspace 5 with live titles that appear and disappear with tickets, and `conductor chat` runs in a terminal on the current workspace; switching to `herdr` moves them into one herdr workspace with a tab per project and a pane per worker, without restarting any run.

**M4 — Usage analytics, full web app**
- Usage API with the shared windows/grains, daily rollups, the spec index and its tools (§12.5), OTLP export, log retention, `conductor doctor`, workspace export/import.
- UI: Decisions inbox, Usage (all views in §16.3), Knowledge & Specs with the Spec Explorer and graph view, Settings (all sections incl. presentation and model dropdowns), command palette, search, PWA, voice dictation; the design-language pass (§21.1 tokens, Linear-grade layout and interaction, both themes, status set) applied everywhere, reviewed with the human on the three reference screens.
- Accept: after the M2 demo, the Usage view shows the feature ticket's tokens and cost per turn, the project's last-7-days series by day, and the model mix; `conductor usage --scope ticket:ACME-42` matches the UI to the token; a UX review session with the human signs off the Chat, Team and Usage views on desktop and phone.

**M5 — More runtimes and plugin API**
- Codex, OpenCode, Gemini adapters (args, event parsers with fixtures, session resume/fork, cwd=home instruction discovery verified, per-workspace config homes, `listModels`, `conductor runtime login`), `plugin-sdk` stabilized with sample runtime, channel and surface plugins in `examples/`, webhooks, OpenAPI + `llms/api.txt`.
- Accept: the M2 demo passes with the role on Codex and again on OpenCode; the model dropdown shows each runtime's models; a third-party surface plugin loaded from a local path places agents somewhere new.

**M6 — Hardening**
- Stale conductor session bootstrap, reconciliation of tickets against forge/OpenSpec reality, routines (cron), scheduled knowledge curation on the 14-day trigger, workspace pause/resume, worker archive purge, the `claude --bg`/`attach` interactive spike (ADR).
- Accept: a 48-hour soak with two workspaces, three projects, four roles and up to twelve concurrent workers shows no lost wakes, no orphan processes or worktrees, no liveness violations older than 5 minutes, and usage totals that reconcile with runtime-reported totals.

---

## 23. Decision log (answers to the first-pass questions, 2026-09-03)

| # | Question | Decision |
|---|---|---|
| 1 | Single or multi-workspace daemon | **Multi-workspace from M1.** One daemon per host, registry of workspaces, one SQLite DB each, workspace-scoped API. |
| 2 | Conductor model | **Human-configured.** A dropdown of models from the conductor's runtime (`listModels()`), in settings and `conductor conductor set-model`. |
| 3 | Where OpenSpec artifacts live / when to archive | **Artifacts on the ticket branch; archive on the default branch after merge**, by the daemon. |
| 4 | Merge authority | **The implementing worker merges its own ticket once the human approves, and resolves merge conflicts itself.** New `merging` status; daemon verifies. Superseded in part by #18. |
| 5 | Direct chat with workers | Allowed, through the worker's ticket only (superseded by #17). |
| 6 | Hire approval | Human approves each hire; the approval card doubles as the runtime switch before the first run. |
| 7 | Sandboxing | None in v1; CLIs run on the host under their own permission model. |
| 8 | Database | SQLite only for now. |
| 9 | Addressing the human | By configured name; **"captain" when no name is provided.** |
| 10 | Telemetry | OpenSpec telemetry disabled by us; CLI telemetry is the operator's setting. No AgentConductor phone-home. |

Added requirements from the same review, folded in: presentation surfaces with herdr and Hyprland (§14b), two polished front doors, web and terminal (§21).

**Third review (same day):**

| # | Question | Decision |
|---|---|---|
| 11 | Persistent per-project agent vs disposable per-ticket workers | **Roles are templates; a fresh worker is spawned per ticket** (firstmate's crewmate model), with one session for the ticket's life. Concurrency = more workers. Cross-ticket familiarity lives in the project KB and the repo, not in sessions. §11 rewritten. |
| 12 | Worktree tooling: worktrunk vs agenttools/worktree vs our own pool | **A `WorktreeProvider` interface with worktrunk as the default and plain `git worktree` as the built-in fallback.** agenttools/worktree was rejected: Claude-only, GitHub-issue-bound, macOS/iTerm2+tmux, 13 stars, no merge workflow, and it spawns its own Claude workers, which duplicates AgentConductor's job. The pool idea is dropped; worktrunk's hooks and build-cache copying cover the warm-up need. The landed-work removal rule stays. §11.5 rewritten. |

**Fifth review (2026-09-04):**

| # | Question | Decision |
|---|---|---|
| 23 | Specs as knowledge | OpenSpec specs and changes are indexed per project and explorable in the UI next to the knowledge bases (Spec Explorer with capability pages, change pages, search and a graph view); the conductor uses the index to answer questions. §12.5. |
| 24 | Mockup accepted | The Claude Design mockup is imported and its decisions adopted (`docs/design/DESIGN-CONTRACT.md` §7): land on Needs you after sign-in, five tabs + floating Start Work, six board columns, push-to-talk on desktop, needs-you in the accent hue, worker questions as decision cards, auto-merge suppresses only the merge card, specs read-only. |
| 22 | Remote daemon | **Remote-first is core.** The daemon is a server that can run on any host; web app, `conductor` and Telegram are remote clients; password-gated (+TOTP) and TLS off-loopback; presentation surfaces run in a client-side presenter. §4.4, §14b, §19. |
| 18 | Merge consent | **A worker never merges without human approval unless the ticket has `auto_merge` on (default off).** The human can set it on a ticket, or tell the conductor to create a ticket with it on. The conductor can never approve a merge itself. §11.4. |
| 19 | Budgets | **No budgets in v1.** Usage is collected and surfaced workspace-wide, per project, per ticket, per role/worker, per model, over 24 h / day / week / month windows. §16. |
| 20 | Frontend input | Mobile-first web app with voice dictation (mic button and keyboard shortcut) for prompting the conductor and for "Start Work". §21.1. |
| 21 | Web design language (revised) | **Linear as the UI/UX reference**: fast, calm, keyboard-first, dense lists, subtle borders, small radii, one accent, Linear-style status glyphs, `⌘K` for everything, **light and dark modes as equals**. Paperclip's tokens-only and status-vocabulary discipline kept. §21.1. |

**Fourth review (2026-09-03):**

| # | Question | Decision |
|---|---|---|
| 13 | Hyprland rules delivery | **Never touch any Hyprland config file.** Rules and windows are applied at runtime through `hyprctl` (keyword rules re-applied on start/reconcile); `conductor doctor` prints equivalent lines for humans who want them persistent. §14b.3. |
| 14 | Terminal emulator | **System default**: `$TERMINAL`, else `xdg-terminal-exec`, else ask; no hard-coded list. Per-emulator flag spelling handled by a small table. §14b.3. |
| 15 | Raw CLI TUI per worker | **Approved for M6**: `claude --bg` + `claude attach` behind `interactive: true` per role on the Claude runtime, with `conductor attach` fallback and an ADR. §14b.4. |
| 16 | Web design language | ~~Boxy, terminal-like~~ Superseded by #21. |
| 17 | Chat scope | **Only with the conductor and with live workers, and worker chat happens through the ticket** (comments that wake the worker; relayed to bound threads). No chat workers, no talking to a role. §11.7, §14.2. |
| 6 | worktrunk config ownership | Resolved: `wt --config <file> --config-set …` scopes every invocation to the daemon's generated config; the human's config is untouched. |

### Remaining open questions

None at the moment. New ones are added here as they arise.

---

## 24. Appendix: what "done" looks like for the implementer

- Every §6 table exists with constraints; every §9.2 tool exists with the stated scope; every §20 command exists.
- `docs/adr/` records deviations from this plan with reasons.
- `docs/demos/M1..M6.md` scripts pass.
- Research files in `docs/research/` are the reference when a rule's rationale is unclear; the plan wins on conflict.

**Gaps closed in the final pass (2026-09-04).** Webhook dispatch (HMAC-signed, at-least-once, per-webhook cursor); supervisor curation (10 min), forge reconciliation + archive backfill (hourly) and retention (daily) with persisted stamps; workspace export/import; `conductor workspace pause|resume|export|import`, `conductor project set-runtime|set-policy`, `conductor daemon install-service --launchd`; `/help` on every channel; plugin loader resolving relative `plugins:` paths against the workspace root; Dockerfile + `docs/DOCKER.md`; `examples/plugins/echo-channel`. `ac_report` with `state: done` closes `question` tickets, and tickets can be created by project slug. Verified live on the Claude Code and OpenCode runtimes.
