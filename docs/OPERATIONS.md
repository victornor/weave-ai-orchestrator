# Operations

Running an AgentConductor daemon on a server: install, TLS, service management, backups, upgrades,
troubleshooting. For what the product *is*, start at [`../README.md`](../README.md).

The daemon host is the machine where code actually runs. It holds:

- the workspace directories (repos, worktrees, worker homes, knowledge bases, the SQLite DB),
- the coding CLIs and their credentials,
- git/SSH keys and `gh` auth,
- channel bot tokens and any secret referenced from `workspace.yaml`,
- `worktrunk` and `openspec`.

Everything else — web app, `conductor`, Telegram, `conductor presenter` — is a client and holds nothing but a
session token.

---

## 1. Install

```bash
# Node >= 22 (node:sqlite). Node 26 and pnpm 11 via mise is what the repo pins.
git clone <this repo> ~/src/agent-conductor && cd ~/src/agent-conductor
mise install                              # or install node >= 22 and pnpm yourself
pnpm install
pnpm build
pnpm --filter @agent-conductor/ui build     # the web app; without it the daemon serves a placeholder

cd packages/cli && pnpm link --global && cd -   # puts `conductor` on PATH
```

Optional but recommended on the host:

```bash
npm i -g @fission-ai/openspec     # spec-driven change tickets and the Spec Explorer
pacman -S worktrunk               # the `wt` binary, default worktree provider (Arch)
```

Host-only setup that nothing else can do for you:

```bash
conductor runtime login claude           # per-workspace config home; repeat per runtime you use
gh auth login                     # required for deliveryMode: pr
ssh-keygen -t ed25519             # and register the key with your forge
```

---

## 2. Daemon configuration

`~/.config/agent-conductor/daemon.yaml` (or `$XDG_CONFIG_HOME/agent-conductor/daemon.yaml`, or the
directory passed as `--config-dir`). Full key list is in the README; the operational ones:

```yaml
version: 1
http:
  listen: 0.0.0.0:7433
  publicUrl: https://conductor.example.com
  trustProxy: true            # ONLY when a reverse proxy you control sets X-Forwarded-*
  tls:
    mode: files               # none | self-signed | files
    cert: /etc/letsencrypt/live/conductor.example.com/fullchain.pem
    key:  /etc/letsencrypt/live/conductor.example.com/privkey.pem
auth:
  loopbackTrusted: false
  sessionDaysNamed: 30
  sessionHoursUnnamed: 12
  lockoutAttempts: 5
  lockoutMinutes: 15
logLevel: info
```

The same directory also holds `workspaces.yaml` (the registry of workspace paths), `daemon.sqlite`
(operator account, sessions, TOTP), and `daemon.json` (written while the daemon runs: pid,
`publicUrl`, `loopbackUrl`).

**The public listener is held** on a non-loopback bind until an operator password exists (unless
`auth.loopbackTrusted` is set). The daemon still starts: the loopback listener serves
`POST /api/auth/setup`, `daemon.json` carries `setupRequired: true`, and `conductor daemon set-password`
run on the daemon host (minimum 8 characters) opens the public listener in place, no restart needed.
Nothing is ever reachable from the network unauthenticated.

Two listeners always run:

| Listener | Bind | Purpose |
|---|---|---|
| public | `http.listen` | API, SSE, web app, `conductor`, channels |
| loopback | `127.0.0.1:<random>` (or `AC_LOOPBACK_SOCKET`) | run tokens, the agents' MCP endpoint, the presenter socket. **Never reachable from outside the host.** |

### TLS modes

| `http.tls.mode` | Behaviour | Use when |
|---|---|---|
| `none` | plain HTTP | loopback only, or strictly behind a proxy on the same host |
| `self-signed` | generates `self-signed.crt`/`.key` in the config dir on first start (10-year, SANs from `tls.domains` plus `127.0.0.1`) | LAN, Tailscale, anything where clients can pin. Clients use `conductor login <url> --pin`. |
| `files` | reads `tls.cert` and `tls.key` (PEM) | you already have a certificate — Let's Encrypt via certbot, an internal CA, Tailscale certs |
| `acme` | **not implemented** — the daemon throws `http.tls.mode "acme" is not implemented; use a reverse proxy or mode "files"` | — |

`conductor login` refuses to send a password in plaintext to a non-loopback host unless you pass
`--insecure`. Don't.

### Reverse proxy

Terminate TLS in the proxy, run the daemon on loopback with `tls.mode: none`, and set
`trustProxy: true` plus an explicit `publicUrl`. SSE needs buffering off and a long read timeout.

```yaml
# daemon.yaml
http:
  listen: 127.0.0.1:7433
  publicUrl: https://conductor.example.com
  trustProxy: true
  tls: { mode: none }
```

Caddy:

```caddyfile
conductor.example.com {
    reverse_proxy 127.0.0.1:7433 {
        flush_interval -1          # required: SSE must not be buffered
    }
}
```

nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name conductor.example.com;
    ssl_certificate     /etc/letsencrypt/live/conductor.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/conductor.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:7433;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        proxy_buffering    off;      # SSE
        proxy_cache        off;
        proxy_read_timeout 3600s;    # long-lived event streams
    }
}
```

---

## 3. Running as a service

```bash
conductor daemon install-service          # writes ~/.config/systemd/user/agent-conductor.service
conductor daemon install-service --print  # just show the unit
```

The generated unit:

```ini
[Unit]
Description=AgentConductor daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/path/to/node /path/to/packages/server/dist/bin.js
Environment=AC_CONFIG_HOME=/home/you/.config/agent-conductor
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now agent-conductor.service
systemctl --user status agent-conductor.service
loginctl enable-linger "$USER"     # keep it running after you log out
```

Notes before you enable it:

- **The daemon resolves its config directory from `XDG_CONFIG_HOME` (falling back to `$HOME/.config`)
  or from `--config-dir`, and `AC_CONFIG_HOME` overrides both.** The `AC_CONFIG_HOME` line the generator emits is therefore effective; if your
  config lives anywhere other than `$HOME/.config/agent-conductor`, edit the unit and add
  `Environment=XDG_CONFIG_HOME=/your/config/parent` or append `--config-dir /your/path` to
  `ExecStart`. Verify with `conductor daemon status` after starting.
- The unit inherits the user session's environment only partially. Any `${ENV_VAR}` referenced from
  a `workspace.yaml` (Telegram bot tokens, plugin secrets) must be added to the unit explicitly —
  `Environment=TELEGRAM_BOT_TOKEN=…`, or better `EnvironmentFile=%h/.config/agent-conductor/env`
  (mode 0600). The daemon logs `workspace.yaml references environment variables that are not set`
  when one is missing, and the Telegram channel refuses to start with an unresolved reference.
- A system-wide unit is fine too, but then `HOME` must point at the account that holds the coding-CLI
  credentials and the SSH keys, or nothing will authenticate.
- Under systemd the daemon logs to the journal, not to `~/.local/state/agent-conductor/daemon.log`
  (that file only exists for a daemon started by `conductor daemon start`). Do not run both.

`conductor daemon stop` only stops a daemon that `conductor daemon start` launched from this machine; under
systemd use `systemctl --user stop agent-conductor.service`.

`conductor daemon start --listen host:port` exports `AC_LISTEN`, which the daemon honours (it overrides `http.listen` in `daemon.yaml`); `node packages/server/dist/bin.js --listen 127.0.0.1:9000` does the same.

---

## 4. Logs

| Where | What |
|---|---|
| `journalctl --user -u agent-conductor -f` | the daemon under systemd (pino JSON on stderr) |
| `~/.local/state/agent-conductor/daemon.log` | the daemon started by `conductor daemon start`; `conductor daemon logs -f` tails it |
| `<workspace>/.agent-conductor/runs/<runId>/` | per-run stdout/stderr, the raw normalized event stream (`.jsonl`), the MCP config and the prompt file |
| `conductor runs list` / `conductor runs show <id> [--raw]` / `conductor runs tail <id>` | the same, through the API |
| `conductor daemon status` | local process state plus `GET /api/health` |

`logLevel: debug` in `daemon.yaml` (or `AC_LOG_LEVEL=debug`) turns on per-wake and per-event
detail. Run logs are pruned after `defaults.runLogRetentionDays` (30) per workspace. Telemetry never
leaves the host; OTLP export happens only if you set `otlpEndpoint`.

---

## 5. Backups

Two things, and nothing else:

1. **Every workspace directory.** It contains `workspace.yaml`, `knowledge/`, `roles/`,
   `.agent-conductor/db.sqlite` (all tickets, runs, decisions, usage), the primary clones, live worker
   homes and worktrees, and `archive/`.
2. **`~/.config/agent-conductor/`** — `daemon.yaml`, `workspaces.yaml`, `daemon.sqlite` (operator
   account, sessions, TOTP secret), TLS material.

```bash
systemctl --user stop agent-conductor.service       # quiesce so SQLite is consistent
tar czf ac-backup-$(date +%F).tar.gz \
    -C "$HOME" .config/agent-conductor \
    -C "$HOME" work/acme
systemctl --user start agent-conductor.service
```

If you cannot stop the daemon, back up the databases with SQLite's online backup instead of copying
the files:

```bash
sqlite3 ~/work/acme/.agent-conductor/db.sqlite ".backup '/backup/acme-db.sqlite'"
sqlite3 ~/.config/agent-conductor/daemon.sqlite ".backup '/backup/daemon.sqlite'"
```

Safe to exclude: `<workspace>/.agent-conductor/runs/` (log volume; only history is lost) and
`<workspace>/projects/*` (re-clonable, but then unlanded worker branches are gone too — do not
exclude it while tickets are in flight).

`conductor workspace export <dir>` produces a portable, secret-free package (role specs, charters,
knowledge, tickets as markdown) — that is a migration tool, not a backup.

Restore: put the directories back, make sure `workspaces.yaml` points at the restored paths, start
the daemon. It reconciles declared configuration against the DB on load; missing clones are re-cloned
and DB rows with no declaration are flagged, never deleted.

---

## 6. Upgrading

```bash
systemctl --user stop agent-conductor.service
cd ~/src/agent-conductor
cp ~/.config/agent-conductor/daemon.sqlite /tmp/daemon.sqlite.bak   # cheap insurance
git pull
pnpm install
pnpm build
pnpm --filter @agent-conductor/ui build
systemctl --user start agent-conductor.service
conductor doctor
```

- Schema migrations run automatically when a database is opened. There is no down-migration; the
  backup is the rollback.
- The unit's `ExecStart` holds an absolute path to `packages/server/dist/bin.js`. Re-run
  `conductor daemon install-service` if you moved the checkout.
- Skills and prompt templates are re-installed into every agent home when the shipped versions
  change; an agent's local edits are overwritten by design.
- In-flight work survives: runs whose processes are gone are marked `interrupted`, their wakes are
  re-queued once, and worktrees and worker homes are exactly where they were. Nothing is ever reset.
- After a version bump, `conductor daemon status` and `conductor doctor` are the two things to look at.

---

## 7. Troubleshooting

### Locked out — `auth_locked` (HTTP 429)

Five failed logins within `auth.lockoutMinutes` lock the account. Wait it out (15 minutes by
default), or clear the attempts:

```bash
systemctl --user stop agent-conductor.service
sqlite3 ~/.config/agent-conductor/daemon.sqlite \
  "DELETE FROM login_attempts WHERE username = 'operator';"
systemctl --user start agent-conductor.service
```

**Forgotten password.** `POST /api/auth/setup` is refused once an operator exists (`conflict`), and
`conductor daemon set-password` then needs the current password. To reset, delete the operator row and
start over — this also invalidates every session and any TOTP enrolment:

```bash
systemctl --user stop agent-conductor.service
sqlite3 ~/.config/agent-conductor/daemon.sqlite \
  "DELETE FROM auth_sessions; DELETE FROM operator;"
systemctl --user start agent-conductor.service
conductor daemon set-password
```

**Lost TOTP device.** Use one of the recovery codes shown at enrolment in place of the six-digit code
(`conductor login` accepts it at the "Six-digit code" prompt). If those are gone too, reset the operator as
above.

**Suspicious session.** `conductor devices list`, then `conductor devices revoke <id>` or `conductor devices revoke --all`
(everything except the session you are using). Same list in Settings → Devices.

### `conductor login` fails on TLS

Self-signed daemon: use `--pin`. It fetches the certificate, shows you the subject and validity,
stores the SHA-256 fingerprint in the context, and trusts exactly that certificate afterwards. If
you regenerate the certificate (delete `self-signed.crt`/`.key` and restart), every pinned client
must `conductor login --pin` again. Plaintext to a non-loopback host is refused; `--insecure` overrides it
and you should not need to.

### Credentials: a runtime is `missing` or every run fails with `auth`

```bash
conductor runtime list          # detection, version, path per runtime
conductor doctor                # includes each runtime with the fix for it
```

- `missing` means the CLI is not installed **on the daemon host**. Installing it on your laptop does
  nothing.
- Installed but unauthenticated: the daemon copies host credentials into
  `<workspace>/.agent-conductor/runtimes/<runtime>/` **once, when the workspace is first loaded** and
  only when that config home has no credential file yet. If you logged the CLI in afterwards, the
  copy never happened. Fix it with `conductor runtime login <id>`, which runs the CLI's own login flow with
  its config-home env pointed at the workspace:

  | Runtime | env | command |
  |---|---|---|
  | claude | `CLAUDE_CONFIG_DIR` | `claude setup-token` |
  | codex | `CODEX_HOME` | `codex login` |
  | opencode | `XDG_CONFIG_HOME` | `opencode auth login` |
  | gemini | `GEMINI_CLI_HOME` | `gemini` (prompts on first run) |

  `conductor runtime login <id> --print` shows the plan without running anything — use that when you need to
  run the login by hand, e.g. over SSH with a browser flow.
- Git/forge auth is separate: `gh auth status` and `ssh -T git@github.com` as the daemon's user.
  Workers deliver via `gh` when `deliveryMode: pr`; without it, set `deliveryMode: local-branch` in
  `defaults` or the project's `policies`.

### `worktrunk` is missing

Symptom: worker spawn fails on worktree creation, or `conductor worktree list` is empty for a project
configured with `worktrees: worktrunk`.

`wt` is the binary (`pacman -S worktrunk` on Arch). The built-in `git worktree` provider is a full
fallback and passes the same contract — switch to it per project or workspace-wide:

```yaml
defaults:
  worktrees: git
projects:
  - id: api
    worktrees: git
    warmPaths: [node_modules, .venv]   # gitignored caches rsynced into each new worktree
    setupCommand: pnpm install
```

Then restart the daemon (or `PATCH /api/w/<ws>/config`) and re-spawn. Existing worktrees are not
migrated; finish or discard the tickets that own them first. With `worktrunk` present the daemon
always passes `--config <workspace>/.agent-conductor/wt.toml`, so your personal worktrunk config is
never read or written.

### `openspec` is missing

Everything keeps working — a missing binary is never fatal — but `change` tickets degrade:

- `ac_openspec_status` returns a zeroed record and the daemon logs `openspec binary missing`;
- proposal validation reports `the openspec binary is not installed` instead of validating;
- archiving after merge is skipped (`skipped: "the openspec binary is not installed"`), so no archive
  commit is made;
- `conductor specs list|show|changes` and the Spec Explorer are empty.

Fix: `conductor doctor --install` (or `npm i -g @fission-ai/openspec` by hand), confirm with `openspec --version`, then re-run
`conductor project fetch` (which reindexes) or `POST /api/w/<ws>/specs/<project>/reindex`. If the binary is
somewhere unusual, point the daemon at it with `AC_OPENSPEC_BIN=/path/to/openspec` in the unit. To
opt a project out entirely, set `openspec: { enabled: false }` on it.

### Workers stall or pile up

```bash
conductor top                       # fleet view
conductor worker list --all
conductor runs list -s running
conductor worker show <id>          # session, ticket, last run, spend
conductor runs tail <id>
```

The supervisor runs every 15 s and escalates on its own: silence past
`defaults.silenceTimeoutSec` (600) with no worktree writes → interrupt, then kill the process group,
then relaunch the same worker into the same home and worktree with a progress note; a second failure
gets a fresh session; a third marks the worker `error` and the ticket `blocked` with the conductor
woken. Manual overrides: `conductor worker relaunch <id> --note "..."`, `conductor worker cancel <id>`,
`conductor runs cancel <id> --mode kill`.

If work is not starting at all: check `role_full` (a role's `maxWorkers`, or the project's
`maxWorkers` across all roles), that the role is `active` (`conductor role list`), and that the workspace is
not paused (`POST /api/w/<ws>/resume`; there is no `conductor workspace pause|resume` yet).

### Nothing is reachable

```bash
conductor daemon status                       # local pid + GET /api/health
curl -sk https://conductor.example.com/api/health | jq
conductor context show                        # which URL and workspace the CLI is actually using
```

`net_daemon_unreachable` means the client could not reach the URL at all — wrong context, firewall,
proxy down, or the daemon refused to start. Check the journal: a refusal to bind prints
`refusing to listen on <host>: no operator password is set`.

### The web app shows "the web UI has not been built"

`packages/ui/dist` is missing or the daemon was pointed elsewhere. Run
`pnpm --filter @agent-conductor/ui build` and reload, or start the daemon with `--ui-dir <path>` /
`AC_UI_DIR=<path>`. The API stays fully live either way (`/api/openapi.json`, `/llms/api.txt`).

### Disk fills up

`<workspace>/.agent-conductor/runs/` and `<workspace>/archive/workers/` are the usual culprits, then
per-worker `node_modules` in worktrees. **Neither is pruned automatically yet** —
`defaults.runLogRetentionDays` (30) and `defaults.workerArchiveDays` (30) are accepted by the config
schema but nothing enforces them, so delete old run directories and worker archives yourself (a
`find … -mtime +30 -delete` in a cron job is enough; run directories are named by run id and nothing
else references them once the run is finished). `conductor worker purge <id>` removes one worker's home and
worktree (refuses a dirty worktree without `--force`). Never delete a live worker's `work/` by hand —
`conductor worktree verify <id>` tells you whether the work has landed, and `conductor worktree discard <id>` is
the supported destructive path.
