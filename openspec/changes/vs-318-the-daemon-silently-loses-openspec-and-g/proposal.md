## Why

On 2026-09-13 the host rebooted and the daemon started under systemd with a minimal PATH
(`/usr/local/bin:/usr/bin`), so the mise-installed `openspec` and `gh` were invisible to it. Every
change ticket's `proposed` transition failed in three workspaces, PR delivery was blocked, the
failures were misreported as "the openspec binary is not installed", and nobody was told until a
worker's gate failed. A restart with the right PATH fixes today's outage; this change fixes the
product so a bare PATH can never silently disarm planning and delivery again, and so the condition
is visible when it does happen.

## What Changes

- **The daemon resolves host tools itself at startup.** Before loading workspaces or spawning any
  host tool, it asks the daemon user's login shell for its `PATH` and merges it into its own process
  `PATH`, so `openspec`, `gh`, `wt` and `git` are found regardless of the PATH the service manager
  happened to hand it. Asking the user's own shell is deployment-agnostic: whatever the user set up
  — mise, asdf, nvm, Homebrew, a global `npm -g` prefix, a plain `~/.local/bin` — is already on that
  shell's `PATH`, so no tool manager or distribution is assumed. This survives a reboot where the
  daemon starts before the user's session, and needs no reinstall.
- **`hostToolPaths` becomes a daemon setting** as an escape hatch, applied ahead of the login-shell
  `PATH`, for the unusual layout the shell does not cover. Zero configuration is the norm; it is
  exposed, with the detected tool list, in a new daemon Settings → **Host tools** section.
- **A not-found host tool names the daemon's PATH**, not "not installed". A tool that is present but
  fails still reports a real failure; the two are no longer conflated.
- **Unavailability is visible without anyone probing `/api/health`**: a daemon-wide web notice, and a
  warning line in the briefing snapshot's `warnings` that the weaver reads.
- **`weave_openspec_status` reports an error when the openspec binary cannot run**, instead of
  answering `planningComplete: false, artifacts: []` as if nothing were planned.

## Capabilities

### New Capabilities

- `host-tools`: the daemon's resolution of host CLIs (`git`, `gh`, `openspec`, `wt`) independent of
  its inherited PATH; the `hostToolPaths` daemon setting and its Settings section; how a missing
  tool is reported; and how an unavailable required or recommended tool becomes visible (daemon
  notice + weaver warning).
- `agent-tools/openspec-status`: `weave_openspec_status` reports a host-tool failure rather than an
  empty plan when the openspec binary cannot be executed.

### Modified Capabilities

- `web-settings/settings-scopes`: adds a daemon-area **Host tools** section, so the setting is filed
  under the scope its data actually has.

## Impact

- `packages/shared/src/config.ts` — `DaemonConfigSchema.hostToolPaths`; `packages/ui/src/api/types.ts`
  — `Health.host.tools` gains a resolved `path`.
- `packages/core/src/tools/host.ts` — login-shell `PATH` discovery, `ensureHostToolPath()`, sync
  warning snapshot, resolved path, PATH-carrying not-found message; `packages/server/src/daemon.ts`
  calls it at startup.
- `packages/core/src/openspec/cli.ts` and `packages/core/src/openspec/index.ts` — not-found message,
  gate message, `statusFor` no longer swallows a binary failure.
- `packages/core/src/briefing/service.ts` — host-tool warning lines.
- `packages/server/src/routes/daemon.ts` + `docs/API.md` — `GET`/`PUT /api/daemon/host-tools`.
- `packages/ui` — `Settings.tsx` / `lib/settings.ts` host-tools section, `AppShell.tsx` notice banner.
- No database migration; no `weave_*` tool rename; planning, apply, archive and delivery surfaces
  keep their existing contracts apart from the corrected openspec-status error.
