# Operations

Running an Weave AI daemon on a server: install, TLS, service management, backups, upgrades,
runtime credentials, troubleshooting. For what the product *is*, start at [`../README.md`](../README.md).

The daemon host is the machine where code actually runs. It holds:

- the workspace directories (repos, worktrees, worker homes, knowledge bases, the SQLite DB),
- the coding CLIs and their credentials — one per runtime, shared with your own CLI (§7),
- git/SSH keys and `gh` auth,
- channel bot tokens and any secret referenced from `workspace.yaml`,
- `worktrunk` and `openspec`.

Everything else — web app, `weave`, Telegram, `weave presenter` — is a client and holds nothing but a
session token.

---

## 1. Install

```bash
# Node >= 22 (node:sqlite). Node 26 and pnpm 11 via mise is what the repo pins.
git clone <this repo> ~/src/weave-ai && cd ~/src/weave-ai
mise install                              # or install node >= 22 and pnpm yourself
pnpm install
pnpm build
pnpm --filter @weave-ai/ui build     # the web app; without it the daemon serves a placeholder

cd packages/cli && pnpm link --global && cd -   # puts `weave` on PATH
```

`weave daemon install-service` and every `weave daemon upgrade` also write `~/.local/bin/weave`
(pointing at the current release), so a host that upgrades gets the command even if it was first set
up under the old name; the legacy `conductor` command keeps working as a deprecated alias.

Optional but recommended on the host:

```bash
npm i -g @fission-ai/openspec     # spec-driven change tickets and the Spec Explorer
pacman -S worktrunk               # the `wt` binary, default worktree provider (Arch)
```

Host-only setup that nothing else can do for you:

```bash
weave runtime login claude           # per-workspace config home; repeat per runtime you use
gh auth login                     # required for deliveryMode: pr
ssh-keygen -t ed25519             # and register the key with your forge
```

---

## 2. Daemon configuration

`~/.config/weave/daemon.yaml` (or `$XDG_CONFIG_HOME/weave/daemon.yaml`, or the
directory passed as `--config-dir`). Full key list is in the README; the operational ones:

```yaml
version: 1
http:
  listen: 0.0.0.0:7433
  publicUrl: https://conductor.example.com
  trustProxy: true            # ONLY when a reverse proxy you control sets X-Forwarded-*
  tls:
    mode: files               # none | self-signed | tailscale | files
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

**The public listener is held** on a non-loopback bind until an operator password exists. The daemon
still starts: the loopback listener serves `POST /api/auth/setup`, `daemon.json` carries
`setupRequired: true`, and `weave daemon set-password` run on the daemon host (minimum 8 characters)
opens the public listener in place, no restart needed. Nothing is ever reachable from the network
unauthenticated.

> **`auth.loopbackTrusted` is for a loopback bind only.** It lets any peer that connects from
> 127.0.0.1 act as the operator with no password. On a non-loopback `http.listen` (`0.0.0.0`, a LAN
> address) the daemon ignores it and logs a warning at startup. First-time `POST /api/auth/setup` is
> accepted only from a loopback client, whatever the setting: set the password on the daemon host
> (`weave daemon set-password`, or `docker exec` into the container), never over the network.

Two listeners always run:

| Listener | Bind | Purpose |
|---|---|---|
| public | `http.listen` | API, SSE, web app, `weave`, channels |
| loopback | `127.0.0.1:<random>` (or `AC_LOOPBACK_SOCKET`) | run tokens, the agents' MCP endpoint, the presenter socket. **Never reachable from outside the host.** |

### TLS modes

| `http.tls.mode` | Behaviour | Use when |
|---|---|---|
| `none` | plain HTTP | loopback only, or strictly behind a proxy on the same host |
| `self-signed` | generates `self-signed.crt`/`.key` in the config dir on first start (10-year, SANs from `tls.domains` plus `127.0.0.1`) | LAN, Tailscale, anything where clients can pin. Clients use `weave login <url> --pin`. |
| `tailscale` | fetches a publicly trusted (Let's Encrypt) certificate for the daemon's tailnet name from the local tailscaled, serves it, and renews it in place; see below | the daemon is reached over Tailscale and browsers must trust it with no warning |
| `files` | reads `tls.cert` and `tls.key` (PEM) | you already have a certificate — Let's Encrypt via certbot, an internal CA |
| `acme` | **not implemented** — the daemon throws `http.tls.mode "acme" is not implemented; use mode "tailscale" …, mode "files", or a reverse proxy` | — |

#### `tailscale` mode

```yaml
http:
  listen: 100.x.y.z:7433                       # `tailscale ip -4`
  publicUrl: https://myhost.tailnet-name.ts.net:7433
  tls:
    mode: tailscale
    # domains: [myhost.tailnet-name.ts.net]    # optional; default is this node's own tailnet name
```

One-time setup on the daemon host:

1. Enable **HTTPS Certificates** on the DNS page of the Tailscale admin console (MagicDNS must be on).
2. Let the daemon's user fetch certificates: `sudo tailscale set --operator=$USER`.
3. Switch `http.tls.mode` to `tailscale` and restart the daemon.

The certificate comes from tailscaled's LocalAPI (`/var/run/tailscale/tailscaled.sock`, or
`AC_TAILSCALE_SOCKET`), so the `tailscale` binary does not need to be on the daemon's `PATH`. The
certificate is checked every 12 hours and renewed when 30 days or less remain; the new one is swapped
into the running listener, so nothing restarts and open connections are not dropped. A renewal that
fails is logged and retried, and the old certificate stays in service.

If tailscaled is not up yet (a reboot can start the daemon first), start waits and retries for up to
about 150 seconds, logging each wait. After that — or at once for a cause waiting cannot fix — it fails
with a message naming the fix (Tailscale not running, HTTPS Certificates not enabled, or the missing
`--operator`). It never falls back to a self-signed certificate. Browsers trust the certificate without
a warning, so `weave login` needs no `--pin` in this mode.

`weave login` refuses to send a password in plaintext to a non-loopback host unless you pass
`--insecure`. Don't.

### Reverse proxy

Terminate TLS in the proxy, run the daemon on loopback with `tls.mode: none`, and set
`trustProxy: true` plus an explicit `publicUrl`. SSE needs buffering off and a long read timeout.

> **Do not combine a proxy with `auth.loopbackTrusted: true`.** A proxy on the same host connects
> to the daemon from 127.0.0.1, so without care every remote request would look local. The daemon
> treats a request as loopback only if the proxy reports a loopback client: with `trustProxy: true` it
> reads the last `X-Forwarded-For` entry (the one your proxy appended); without `trustProxy` any
> `X-Forwarded-For`, `X-Real-IP` or `Forwarded` header makes the request non-loopback. A proxy that
> sends none of them cannot be told apart from a local client, so keep `loopbackTrusted: false`
> (the default) and use the operator password.

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
weave daemon install-service          # writes ~/.config/systemd/user/weave-ai.service
weave daemon install-service --print  # just show the unit
```

The generated unit:

```ini
[Unit]
Description=Weave AI daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/path/to/node /path/to/packages/server/dist/bin.js
Environment=AC_CONFIG_HOME=/home/you/.config/weave
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
systemctl --user enable --now weave-ai.service
systemctl --user status weave-ai.service
loginctl enable-linger "$USER"     # keep it running after you log out
```

Notes before you enable it:

- **The daemon resolves its config directory from `XDG_CONFIG_HOME` (falling back to `$HOME/.config`)
  or from `--config-dir`, and `AC_CONFIG_HOME` overrides both.** The `AC_CONFIG_HOME` line the generator emits is therefore effective; if your
  config lives anywhere other than `$HOME/.config/weave`, edit the unit and add
  `Environment=XDG_CONFIG_HOME=/your/config/parent` or append `--config-dir /your/path` to
  `ExecStart`. Verify with `weave daemon status` after starting.
- The unit inherits the user session's environment only partially. Any `${ENV_VAR}` referenced from
  a `workspace.yaml` (Telegram bot tokens, plugin secrets) must be added to the unit explicitly —
  `Environment=TELEGRAM_BOT_TOKEN=…`, or better `EnvironmentFile=%h/.config/weave/env`
  (mode 0600). The daemon logs `workspace.yaml references environment variables that are not set`
  when one is missing, and the Telegram channel refuses to start with an unresolved reference.
- A system-wide unit is fine too, but then `HOME` must point at the account that holds the coding-CLI
  credentials and the SSH keys, or nothing will authenticate.
- Under systemd the daemon logs to the journal, not to `~/.local/state/weave/daemon.log`
  (that file only exists for a daemon started by `weave daemon start`). Do not run both.

`weave daemon stop` only stops a daemon that `weave daemon start` launched from this machine; under
systemd use `systemctl --user stop weave-ai.service`.

`weave daemon start --listen host:port` exports `AC_LISTEN`, which the daemon honours (it overrides `http.listen` in `daemon.yaml`); `node packages/server/dist/bin.js --listen 127.0.0.1:9000` does the same.

---

## 4. Logs

| Where | What |
|---|---|
| `journalctl --user -u weave-ai -f` | the daemon under systemd (pino JSON on stderr) |
| `~/.local/state/weave/daemon.log` | the daemon started by `weave daemon start`; `weave daemon logs -f` tails it |
| `<workspace>/.weave/runs/<runId>/` | per-run stdout/stderr, the raw normalized event stream (`.jsonl`), the MCP config and the prompt file |
| `weave runs list` / `weave runs show <id> [--raw]` / `weave runs tail <id>` | the same, through the API |
| `weave daemon status` | local process state plus `GET /api/health` |

`logLevel: debug` in `daemon.yaml` (or `AC_LOG_LEVEL=debug`) turns on per-wake and per-event
detail. Run logs are pruned after `defaults.runLogRetentionDays` (30) per workspace. Telemetry never
leaves the host; OTLP export happens only if you set `otlpEndpoint`.

---

## 5. Backups

Two things, and nothing else:

1. **Every workspace directory.** It contains `workspace.yaml`, `knowledge/`, `roles/`,
   `.weave/db.sqlite` (all tickets, runs, decisions, usage), the primary clones, live worker
   homes and worktrees, and `archive/`.
2. **`~/.config/weave/`** — `daemon.yaml`, `workspaces.yaml`, `daemon.sqlite` (operator
   account, sessions, TOTP secret), TLS material.

```bash
systemctl --user stop weave-ai.service       # quiesce so SQLite is consistent
tar czf ac-backup-$(date +%F).tar.gz \
    -C "$HOME" .config/weave \
    -C "$HOME" work/acme
systemctl --user start weave-ai.service
```

If you cannot stop the daemon, back up the databases with SQLite's online backup instead of copying
the files:

```bash
sqlite3 ~/work/acme/.weave/db.sqlite ".backup '/backup/acme-db.sqlite'"
sqlite3 ~/.config/weave/daemon.sqlite ".backup '/backup/daemon.sqlite'"
```

Safe to exclude: `<workspace>/.weave/runs/` (log volume; only history is lost) and
`<workspace>/projects/*` (re-clonable, but then unlanded worker branches are gone too — do not
exclude it while tickets are in flight).

`weave workspace export <dir>` produces a portable, secret-free package (role specs, charters,
knowledge, tickets as markdown) — that is a migration tool, not a backup.

Restore: put the directories back, make sure `workspaces.yaml` points at the restored paths, start
the daemon. It reconciles declared configuration against the DB on load; missing clones are re-cloned
and DB rows with no declaration are flagged, never deleted.

---

## 6. Upgrading

The daemon runs from an immutable **release directory**, never from a checkout anyone edits:

```
~/.local/share/weave/
  releases/20260904-231500-1a2b3c4d5e/   a clone at one commit, installed and built
  releases/20260905-101200-9f8e7d6c5b/
  current  -> releases/20260905-…         what the service and the `weave` wrapper run
  previous -> releases/20260904-…         one `rollback` away
```

There are two ways in. **`weave daemon update apply`** (and the web app's Settings → Updates) asks
the running daemon to upgrade itself, deferring until no turn is running. **`weave daemon upgrade`**
does it from this shell — the path that still works when the daemon is not answering.

```bash
weave daemon update                       # running version + commit vs the source at its ref
weave daemon update apply                 # queue it: the daemon waits for idle, then upgrades
weave daemon update apply --ref v0.2.0 --test
weave daemon update cancel                # only before the build starts

weave daemon upgrade                      # from this shell; source and ref from daemon.yaml
weave daemon upgrade --ref v0.2.0 --test  # any ref; --test runs the suite before switching
weave daemon releases
weave daemon rollback
```

### The deferred upgrade (`update apply`)

The record moves `queued → waiting → building → switching → restarting → completed | failed | cancelled`
and survives the restart, which is how the outcome is still readable afterwards.

| Stage | What happens | If it fails |
|---|---|---|
| `queued`/`waiting` | Dispatch is held in every loaded workspace the moment the record exists, and one line is posted on the primary chat thread saying so. Running turns are **never cancelled by the wait**; the upgrade waits for them, up to `upgrade.waitForIdleSec` (default 30). Once that bound expires it proceeds to `building` anyway — whatever is still running is ended and resumed by the restart later, exactly like any run a daemon restart interrupts. | Never fails from this stage; it always proceeds. |
| `building` | Clone, install, build (and `--test`) in a fresh release directory. Output is kept as a 200-line tail on the record. | `build_failed`: dispatch resumes, `current` untouched, the old daemon keeps serving. |
| `switching` | Back up `daemon.sqlite` and every workspace db, then swing `current` and prune. | `backup_failed` before the symlink moves; `switch_failed` after the backups. Dispatch resumes either way. |
| `restarting` | A **detached runner** — the new release's CLI — restarts the daemon and polls `/api/health` until it reports the target release. | `restart_failed`: the runner swung `current` back to `previous` and restarted. `restart_unverified`: nobody confirmed the restart (see below). |

Cancel is possible from `queued` and `waiting` only; from `building` on the answer is `409 conflict`.
Cancelling resumes dispatch on every workspace that was not paused in its own right.

**What automatic rollback does and does not cover.** Every failure before the symlink swings leaves the
previous release running, untouched — that is the large majority. After the swing, rolling back is the
runner's job, and the runner has to outlive the restart it triggers. Restarting a systemd **user
service kills that service's whole control group**, so the daemon starts the runner through
`systemd-run --user --scope --collect` where that exists; on launchd and on a bare `daemon start`
install a plain detached process already survives. On a host with systemd but no `systemd-run`, the
runner dies with the restart: nothing rolls back automatically, the next daemon to boot marks the
record `restart_unverified`, and **`weave daemon rollback` is yours to run**.

A daemon that boots while a record is unfinished reconciles it: `restarting` on the target release
becomes `completed`; `restarting` on some other release, past ten minutes, becomes `restart_unverified`;
anything earlier becomes `abandoned`, so a stale record cannot block the next upgrade.

Requesting, cancelling and reading an upgrade all need an operator session. An agent's run token
reaches neither — `/api/daemon/*` is not on the run-token path list.

`upgrade` does, in order: clone `upgrade.source` at `upgrade.ref` into a new release dir and
`pnpm install --frozen-lockfile && pnpm build` there (nothing running is touched yet) → online
backup of `daemon.sqlite` and every workspace db into `~/.config/weave/backups/<stamp>/`
→ switch `current` (and `previous`) → `POST /api/daemon/drain`, which stops dispatching new turns
and waits up to `upgrade.drainTimeoutSec` (default 30s — an agent turn can take many minutes, so this
bound only ever catches the fast case; anything still running restarts anyway and is interrupted and
resumed like any run a restart interrupts) for running ones → `systemctl --user
restart weave-ai.service` (or stop/start when no unit is installed) → wait for
`/api/health`. Releases beyond `upgrade.keep` (default 3) are pruned, never `current` or `previous`.

```yaml
# daemon.yaml
upgrade:
  source: git@github.com:victornor/weave-ai-orchestrator.git   # or a local checkout path
  ref: main
  keep: 3
  drainTimeoutSec: 30      # `daemon upgrade`: how long its drain waits before restarting anyway
  waitForIdleSec: 30       # `update apply`: how long it waits for running turns before proceeding anyway
  updateCheckIntervalSec: 900   # how long "is the source ahead" is cached
```

### Changing the release source, and why a project re-point does not

`upgrade.source` is a daemon setting, not a project setting. **Re-pointing a project at a different
repository does not move it**: the project's `gitUrl` and its clone's `origin` follow the new URL, while
releases keep being built from whatever `upgrade.source` names, and a daemon that still points at the old
repository reports "up to date" instead of "no such repository" whenever the old one still exists.

Change it from the daemon rather than by editing the file:

```bash
weave daemon update source git@github.com:victornor/weave-ai-orchestrator.git
weave daemon update source git@github.com:victornor/weave-ai-orchestrator.git --ref main
weave daemon update source --clear      # back to "update checking is not configured"
```

Settings → Release offers the same change. Both validate it first — the source has to be reachable and the
ref has to exist on it — then write `daemon.yaml` and apply it to the running daemon: the next check and
the next upgrade use the new source with **no restart**. Writing it rewrites `daemon.yaml` through the
schema, so comments in that file are lost, exactly as for the other settings written from the app.

When the source still names a repository the project has been re-pointed away from, the Release panel and
`weave daemon update` say so — this release was built from that repository, and a project that carries its
commit now lives elsewhere. The warning sits beside the update answer, so it cannot hide behind "up to
date". After a re-point, `weave project set-url` and Settings → Projects offer the same repair.

Both bounds default short because expiry no longer means giving up: once dispatch is held, waiting
longer only holds every workspace's dispatch — including the weaver's own — for longer with no
benefit, since a turn that is not done in 30s is not meaningfully closer to done at 900s either. Both
remain overridable per invocation (`--drain-timeout`) or in `daemon.yaml`.

- Schema migrations run automatically when a database is opened. There is no down-migration; the
  backup taken by `upgrade` is the rollback for data, `weave daemon rollback` for code.
- The unit's `ExecStart` points at `current/packages/server/dist/bin.js`; it never needs re-writing
  for an upgrade. `weave daemon install-service` prefers `current` whenever it exists.
- Skills and prompt templates ship inside the release and are re-installed into agent homes when
  they change; an agent's local edits are overwritten by design.
- In-flight work: the drain lets running turns finish. Anything still running at the timeout is
  recorded as `interrupted` (never `failed`), re-queued once on boot, and resumes its session; worktrees and worker homes are
  exactly where they were. Nothing is ever reset.
- `upgrade` and `rollback` refuse to run inside a worker (`AC_RUN_TOKEN` set). Agents developing
  Weave AI propose the change in a ticket; a human runs the upgrade.
- The two paths now handle in-flight work the same way: both `upgrade`'s drain and `update apply`'s
  wait for idle **interrupt** whatever is still running once their bound expires, rather than either
  killing it outright or waiting on it forever — the run is ended and resumed exactly like any run a
  daemon restart interrupts, and neither path ever fails purely because something was still running.
- After an upgrade, `weave daemon status` and `weave doctor` are the two things to look at.

---

## 7. Runtime credentials

### Codex token consumption

Codex reports cumulative usage across a resumed thread. Weave subtracts the previous counter to
record each run's own usage, including its cached-input portion. Existing threads recover their
baseline from the local Codex rollout; if that counter is unavailable, that turn's usage is unknown
rather than charging the entire history again. Previously recorded usage is not rewritten.

The adapter defaults to `toolOutputTokenLimit: 4096` and `compactionPercent: 60` in runtime
options. The percentage uses the discovered model's normal context window; `contextWindowTokens`
overrides both the active Codex window and the calculation. A 1,000,000-token window at 60% yields
`model_auto_compact_token_limit=600000`. An optional `autoCompactTokenLimit` sets an absolute
threshold instead. If the window is unknown, the adapter preserves Codex's own threshold rather
than guessing; configure `contextWindowTokens` to apply a percentage to custom models. These
limit retained tool output and compact long histories earlier; they do not impose a hard spending
limit or a maximum number of model requests. Increase them when a task requires more context.
Compaction can lose older details, so durable facts belong in tickets and knowledge files.

### One credential per runtime per host

Every agent authenticates with **the same credential file the machine owner's own CLI uses**. There
is no second copy anywhere.

| Runtime | The one credential | What the workspace has |
|---|---|---|
| `claude` | `~/.claude/.credentials.json` | `<workspace>/.weave/runtimes/claude/.credentials.json` → symlink |
| `codex` | `~/.codex/auth.json` | `…/runtimes/codex/auth.json` → symlink |
| `gemini` | `~/.gemini/oauth_creds.json`, `~/.gemini/google_accounts.json` | symlinks |
| `opencode` | `~/.local/share/opencode/auth.json` | `…/runtimes/opencode/opencode/auth.json` → symlink |
| `cursor` | `~/.config/cursor/auth.json` | `…/runtimes/cursor/auth.json` → symlink |

Only the credential file is shared. The rest of each runtime's config home — settings, session
history, project state — stays per workspace, which is why `CLAUDE_CONFIG_DIR` still points at the
workspace's own runtime directory.

**Why.** Claude's OAuth rotates the refresh token on every refresh. Two live copies of one rotating
credential race: whichever side refreshes first invalidates the other. Until VS-75 the daemon kept a
copy and re-took it whenever the host's file had a newer mtime, which could overwrite a *working*
credential with a *dead* one. On 2026-09-07 that stopped every agent in the workspace at once.

**Repair.** If a CLI writes its credential by renaming a temp file over the path, it replaces the
symlink rather than following it, and the credential forks again. Once per turn spawn, the daemon
reconciles: it compares the expiry the two credentials assert about *themselves* and keeps the one
that expires later, then restores the link. Modification time is never the criterion — a copy resets
it, and it says nothing about which token is live. The host's credential is replaced only when the
workspace's is provably newer (both expiries readable, the workspace's later), so a credential whose
expiry cannot be read is never clobbered. When nothing has forked — the common case — this check
costs one filesystem stat and writes nothing; it is not run as part of an account/usage probe, only a
turn spawn.

**No forced refresh (VS-285).** The daemon never spawns anything for the purpose of causing a
runtime's CLI to refresh its own credential. VS-105 briefly did — a pre-spawn probe that ran whenever
a credential looked like it might not outlast the turn — but forcing that exchange is exactly what
invalidates every other holder of the refresh token it rotates, including the machine owner's own
already-running CLI, whether or not any daemon-spawned turn was involved. A turn now simply spawns;
the runtime's CLI refreshes on its own terms if it needs to, precisely as it would for the owner's own
interactive use, and reports its own authentication failure if that genuinely fails — handled by
exactly the gate described in "When a login expires" below. A failed turn is cheap; a forced rotation
is not undoable.

**Upgrading.** The first workspace load after the upgrade finds a regular file where the symlink
belongs and reconciles once. A workspace that had its own separate login keeps whichever credential
is live. Nobody is signed out and no login is required.

**Consequence.** `weave runtime login <id>` no longer gives a workspace an independent login: it
logs in the one host credential for that runtime. Multi-account and per-role credentials are not
supported.

### When a login expires

The first turn that fails to authenticate **gates that runtime**:

1. The runtime's credential is marked as needing a login.
2. The dispatcher starts no further turn for any agent on that runtime, in that workspace. Their
   queued wake-ups are left queued, so no work is lost and nothing has to be re-asked.
3. Every agent on the runtime is paused with the reason `runtime_login_expired`.
4. **Exactly one** decision is raised for the human — not one per worker — correlated on
   `runtime-login:<runtimeId>`, so later failures join it.
5. The human is told over the channel path directly. That is deliberate: the weaver is usually on
   the same runtime and cannot take a turn, and an outage must not be able to hide behind an agent
   the outage itself has stopped.

Nothing is retried. An authentication failure does not enter the retry ladder at all, and does not
park workers individually.

**To recover, log the CLI in on the daemon's host:**

```bash
weave runtime login claude   # or codex · opencode · gemini · cursor (the CLI's own login also works if the workspace shares the host's credentials: claude /login · codex login · opencode auth login)
```

That is the whole procedure. Once the credential has changed and the supervisor's probe succeeds (or you press "I fixed it" in the banner), the gate clears, every
paused agent takes the turn it was holding, and the decision withdraws itself. You do not answer the
card and you do not resume any worker — resume is refused while the gate is up, because the
dispatcher would not start that turn anyway.

A probe counts as success only when it can actually describe the account. A missing binary and a
timed-out probe both report "unknown" and deliberately do **not** clear the gate, which would only
start every agent into the same failure again.

### Seeing the state

```bash
weave doctor                       # a `credential <runtime>` check per runtime
curl .../api/w/<ws>/usage/credentials  # present, expiresAt, lastVerifiedAt, refreshFailedAt, needsLogin
```

The Usage view shows the same panel, above the usage charts so it is visible even when a gated
runtime has produced no usage at all.

**No surface ever carries the token.** `RuntimeCredential` has no field that could hold one, and the
runtime's own error message is redacted where it enters the system rather than at each exit.

---

## 8. Troubleshooting

### Locked out — `auth_locked` (HTTP 429)

Five failed logins within `auth.lockoutMinutes` lock the account. Wait it out (15 minutes by
default), or clear the attempts:

```bash
systemctl --user stop weave-ai.service
sqlite3 ~/.config/weave/daemon.sqlite \
  "DELETE FROM login_attempts WHERE username = 'operator';"
systemctl --user start weave-ai.service
```

**Forgotten password.** `POST /api/auth/setup` is refused once an operator exists (`conflict`), and
`weave daemon set-password` then needs the current password. To reset, delete the operator row and
start over — this also invalidates every session and any TOTP enrolment:

```bash
systemctl --user stop weave-ai.service
sqlite3 ~/.config/weave/daemon.sqlite \
  "DELETE FROM auth_sessions; DELETE FROM operator;"
systemctl --user start weave-ai.service
weave daemon set-password
```

**Lost TOTP device.** Use one of the recovery codes shown at enrolment in place of the six-digit code
(`weave login` accepts it at the "Six-digit code" prompt). If those are gone too, reset the operator as
above.

**Suspicious session.** `weave devices list`, then `weave devices revoke <id>` or `weave devices revoke --all`
(everything except the session you are using). Same list in Settings → Devices.

### `weave login` fails on TLS

Self-signed daemon: use `--pin`. It fetches the certificate, shows you the subject and validity,
stores the SHA-256 fingerprint in the context, and trusts exactly that certificate afterwards. If
you regenerate the certificate (delete `self-signed.crt`/`.key` and restart), every pinned client
must `weave login --pin` again. Plaintext to a non-loopback host is refused; `--insecure` overrides it
and you should not need to.

### Credentials: a runtime is `missing` or every run fails with `auth`

```bash
weave runtime list          # detection, version, path per runtime
weave doctor                # includes each runtime with the fix for it
```

- `missing` means the CLI is not installed **on the daemon host**. Installing it on your laptop does
  nothing.
- Installed but unauthenticated: the daemon copies host credentials into
  `<workspace>/.weave/runtimes/<runtime>/` **once, when the workspace is first loaded** and
  only when that config home has no credential file yet. If you logged the CLI in afterwards, the
  copy never happened. Fix it with `weave runtime login <id>`, which runs the CLI's own login flow with
  its config-home env pointed at the workspace:

  | Runtime | env | command |
  |---|---|---|
  | claude | `CLAUDE_CONFIG_DIR` | `claude setup-token` |
  | codex | `CODEX_HOME` | `codex login` |
  | opencode | `XDG_CONFIG_HOME` | `opencode auth login` |
  | gemini | `GEMINI_CLI_HOME` | `gemini` (prompts on first run) |

  `weave runtime login <id> --print` shows the plan without running anything — use that when you need to
  run the login by hand, e.g. over SSH with a browser flow.
- Git/forge auth is separate: `gh auth status` and `ssh -T git@github.com` as the daemon's user.
  Workers deliver via `gh` when `deliveryMode: pr`; without it, set `deliveryMode: local-branch` in
  `defaults` or the project's `policies`.

### `worktrunk` is missing

Symptom: worker spawn fails on worktree creation, or `weave worktree list` is empty for a project
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
always passes `--config <workspace>/.weave/wt.toml`, so your personal worktrunk config is
never read or written.

### `openspec` is missing

Everything keeps working — a missing binary is never fatal — but `change` tickets degrade:

- `weave_openspec_status` returns a zeroed record and the daemon logs `openspec binary missing`;
- proposal validation reports `the openspec binary is not installed` instead of validating;
- archiving after merge is skipped (`skipped: "the openspec binary is not installed"`), so no archive
  commit is made;
- `weave specs list|show|changes` and the Spec Explorer are empty.

Fix: `weave doctor --install` (or `npm i -g @fission-ai/openspec` by hand), confirm with `openspec --version`, then re-run
`weave project fetch` (which reindexes) or `POST /api/w/<ws>/specs/<project>/reindex`. If the binary is
somewhere unusual, point the daemon at it with `AC_OPENSPEC_BIN=/path/to/openspec` in the unit.

### OpenSpec is optional per project (VS-578)

Every project has an OpenSpec mode, **on by default**. It is a project property, set from the
project config key `openspec.enabled`, the Settings Projects section, or `weave project
set-openspec <id> on|off`.

- **On** (default, and the right choice for production and customer-facing projects): a `change`
  ticket is bound to an OpenSpec change and runs propose → plan approval → apply → merge → archive.
  Nothing about this flow changed.
- **Off** (the fast path, for internal projects where the ceremony is overkill): a `change` ticket
  has no proposal, design, spec deltas, tasks file, validation or archive step. It still has one
  reviewed plan — the worker records a short plan as the ticket document `approach`, the daemon
  publishes it as the plan document, and the plan approval is raised as usual — then implements,
  tests and opens the pull request. Merge approval is unchanged.

The ticket's own binding decides its path, so flipping the mode never breaks work in flight: a ticket
already bound to a change keeps its OpenSpec flow, and a ticket created while the mode was off is
never retroactively asked for spec deltas. Turning the mode on for an existing project whose repo has
no `openspec/` runs the same best-effort `openspec init` the add pipeline uses; on a protected default
branch that push is refused, so adopt OpenSpec through your own pull request instead.

When the mode is off, `weave_openspec_status` reports `enabled: false`, `weave_spec_*` and
`/specs/<project>` return `openspec_disabled`, the ticket page shows no OpenSpec panel, the Specs view
says the mode is off, and the weaver is not warned about a missing `openspec` binary while no project
needs it.

### Visual plan artifacts are optional per project (VS-624)

**Experimental, off by default.** A project can require that every `change` ticket's plan also comes
with a visual artifact — a diagram, a comparison, a sequence or dependency view, or a mock of the
intended result. It is a project policy, set from the project config key
`policies.visualPlanArtifact`, the Settings Projects section (the "Visual plan artifact" control), or
`weave project set-policy <id> visualPlanArtifact=true`. The add-project form offers the same choice,
defaulting off.

When it is on, a `change` ticket must publish a plan artifact with `weave_ticket_artifact_put` under
the key `plan` before it can reach `proposed`; the daemon refuses the transition with a message naming
the tool and the key, on both the OpenSpec path and the fast path. The artifact is stored and served
by the same sandboxed pipeline as any other ticket artifact, and is shown on the plan approval card
and the Plan view through the same viewer. It supports the written plan; it does not replace it.

**It costs worker tokens on every plan**, which is why it defaults off and says so in Settings. The
rule is fixed on the ticket when it begins planning, so flipping the policy never traps a ticket in
flight: a ticket that started while it was off is never asked for an artifact, and one that started
while it was on keeps the requirement even if the policy is turned off. `task`, `scout`, `question`
and `operational` tickets are never affected.

### Workers stall or pile up

```bash
weave top                       # fleet view
weave worker list --all
weave runs list -s running
weave worker show <id>          # session, ticket, last run, spend
weave runs tail <id>
```

The supervisor runs every 15 s and escalates on its own: silence past
`defaults.silenceTimeoutSec` (600) with no worktree writes → interrupt, then kill the process group,
then relaunch the same worker into the same home and worktree with a progress note; a second failure
gets a fresh session; a third marks the worker `error` and the ticket `blocked` with the weaver
woken. Manual overrides: `weave worker relaunch <id> --note "..."`, `weave worker cancel <id>`,
`weave runs cancel <id> --mode kill`.

If work is not starting at all: check `role_full` (the project's `maxWorkers` across all its roles),
that the role is `active` (`weave role list`), and that the workspace is
not paused (`POST /api/w/<ws>/resume`; there is no `weave workspace pause|resume` yet).
`weave role show <id>` prints the project's effective concurrency; raise throughput from the
project's Settings max-workers field, not `weave role set-max-workers`.

### Nothing is reachable

```bash
weave daemon status                       # local pid + GET /api/health
curl -sk https://conductor.example.com/api/health | jq
weave context show                        # which URL and workspace the CLI is actually using
```

`net_daemon_unreachable` means the client could not reach the URL at all — wrong context, firewall,
proxy down, or the daemon refused to start. Check the journal: a refusal to bind prints
`refusing to listen on <host>: no operator password is set`.

### The web app shows "the web UI has not been built"

`packages/ui/dist` is missing or the daemon was pointed elsewhere. Run
`pnpm --filter @weave-ai/ui build` and reload, or start the daemon with `--ui-dir <path>` /
`AC_UI_DIR=<path>`. The API stays fully live either way (`/api/openapi.json`, `/llms/api.txt`).

### Disk fills up

`<workspace>/.weave/runs/` and `<workspace>/archive/workers/` are the usual culprits, then
per-worker `node_modules` in worktrees. **Neither is pruned automatically yet** —
`defaults.runLogRetentionDays` (30) and `defaults.workerArchiveDays` (30) are accepted by the config
schema but nothing enforces them, so delete old run directories and worker archives yourself (a
`find … -mtime +30 -delete` in a cron job is enough; run directories are named by run id and nothing
else references them once the run is finished). `weave worker purge <id>` removes one worker's home and
worktree (refuses a dirty worktree without `--force`). Never delete a live worker's `work/` by hand —
`weave worktree verify <id>` tells you whether the work has landed, and `weave worktree discard <id>` is
the supported destructive path.

---

### Merged branches are deleted from the remote (VS-770)

After the daemon confirms a ticket's pull request merged, it deletes the ticket's branch on the
remote (and the local branch, if it lingers). It is on by default and never fails the landing: a
failed delete is logged and noted once on the ticket.

A branch is deleted only when all of these hold: it is not the project's default branch or a landing
branch; no other open pull request has it as its head; and nothing was pushed to it after the merge.
"Nothing pushed after" is judged two ways, either of which accepts: the forge says the pull request is
merged and the branch head still equals the pull request's head at merge (the only proof for a
squash-merge, whose commit never has the branch head as an ancestor), or the head is an ancestor of the
landing branch (merge-commit and rebase projects). A branch with a newer commit is kept, with one
comment on the ticket saying why.

Turn it off per project with `weave project set-policy <id> deleteBranchAfterMerge=false` or the
"delete branch after merge" control in Settings → Projects (inherit, on or off). A workspace-wide
default goes in `workspace.yaml` as `defaults.deleteBranchAfterMerge: false`; a project's own value wins.

**Clearing the existing backlog.** Nothing is deleted retroactively unless you ask:

```
weave project prune-branches <project> --dry-run    # list what would be deleted
weave project prune-branches <project>              # delete it
```

It considers only branches that belong to a done or cancelled ticket and applies the same rules as the
post-merge delete. The dry run is read-only apart from a `git fetch`.

## 9. Continuous integration

`.github/workflows/ci.yml` runs `lint`, `typecheck`, `test-core` and `test-ui` on every pull request.
The runner labels it asks for are in the workflow's `runs-on` lines; read them there rather than from
this document.

If you run your own fork on a self-hosted GitHub Actions runner, treat the runner as untrusted-code
infrastructure:

- Use an ephemeral (just-in-time) runner, or at least a disposable container, never a long-lived
  shell on a machine that holds credentials.
- Give it no Docker socket, no host mounts, no host network and `--cap-drop=ALL`.
- Block its network path to your LAN, VPN and the daemon, and verify the block before it takes jobs.
- Cap CPU, memory and process count so a job cannot starve the daemon.
- Never register a runner for a repository that accepts pull requests from forks without requiring
  approval for outside contributors.
- Registration tokens are one-hour and single-use; do not store them. Recreating the runner
  container loses its credentials, so re-register.

Packages the test suites shell out to (`tmux`, `git`, `unzip`, `rsync`) must be present on whatever
image runs them; `libatomic1` is needed by pnpm's bundled native executable on slim images.
