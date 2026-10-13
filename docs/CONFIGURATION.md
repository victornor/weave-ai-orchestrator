# Configuration

Files, credentials, runtimes and plugins. The quickstart is in the [README](../README.md#quickstart).

## Credentials

When a workspace loads, the daemon copies the host user's coding-CLI credentials
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

## Configuration files

## `~/.config/weave/` (daemon host; `$XDG_CONFIG_HOME/weave` when set)

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
  loopbackTrusted: false      # true = no password required for loopback clients; ignored (with a warning) unless http.listen is loopback
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

## `<workspace>/workspace.yaml`

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

## `<workspace>/roles/<id>/role.yaml`

Written by the daemon when the weaver hires a role; you normally edit it through the UI. Key
fields: `id`, `name`, `project`, `charterSummary`, `scope`, `responsibilities[]`, `capabilities[]`,
`exclusions[]`, `rules[]`, `sessionPolicy` (`per_ticket` by default), `maxWorkers`,
`permission.{mode,allowed,denied}`. A role names no runtime or model: every worker runs on the
workspace's `models.workers` setting (ADR 0011).
The prose charter lives beside it in `CHARTER.md` and is revisioned; `OVERRIDES.md` is yours.

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

The full authoring guide is [`docs/PLUGINS.md`](PLUGINS.md); a complete worked example —
a tool, storage, a route, and a page — is [`examples/plugins/notes/`](../examples/plugins/notes/).
