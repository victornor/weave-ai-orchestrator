# Tasks

## 1. Daemon setting

- [x] 1.1 Add `hostToolPaths: z.array(z.string()).default([])` to `DaemonConfigSchema` in `packages/shared/src/config.ts`, with a comment naming the resolution it feeds.
- [x] 1.2 Cover the default (empty) and a populated list in `packages/shared/src/config.test.ts`.

## 2. Resolve host tools from the user's environment at startup

- [x] 2.1 In `packages/core/src/tools/host.ts`, add `loginShellPath(opts?)` that runs the daemon user's shell as a login, interactive shell with stdin closed, a bounded timeout and a sentinel around the value, reads stdout only, and returns the reported `PATH` or null when the shell fails, times out or reports nothing; the shell is selected `$SHELL` → `os.userInfo().shell` → `/bin/sh`, and the shell and timeout are injectable for tests.
- [x] 2.2 Add `ensureHostToolPath(extra, opts?)` that assembles `PATH` as configured directories first, then the login-shell entries, then the process's existing entries, adding each directory at most once.
- [x] 2.3 Call `ensureHostToolPath(daemonCfg.hostToolPaths)` in `packages/server/src/daemon.ts` before any workspace loads or host tool spawns.
- [x] 2.4 Add `path` to `HostTool` and populate it in `detectHostTool`, resolving through the assembled `PATH`.
- [x] 2.5 Test (host-independent, no real CLI): with process `PATH=/usr/bin:/bin` and a fake `$SHELL` script reporting a scratch directory that holds a fake `openspec`, `detectHostTool('openspec')` reports it available with that path; with `$SHELL` unset the account-shell/`/bin/sh` fallback is used; a timed-out/silent fake shell leaves `PATH` unchanged; a configured directory precedes the login-shell entries; `AC_OPENSPEC_BIN` wins; discovery compiles in no manager-specific path.

## 3. Name the real condition in host-tool errors

- [x] 3.1 Rewrite the openspec not-found message in `packages/core/src/openspec/cli.ts` to say the binary was not found on the daemon's `PATH` and to include the searched `PATH` / directories; never say "not installed".
- [x] 3.2 Test (pure message): the not-found message contains the daemon's `PATH` and not "not installed"; a found-but-non-zero-exit tool reports a failure, not not-found.

## 4. openspec status and proposed gate

- [x] 4.1 In `packages/core/src/openspec/index.ts`, make `statusFor` propagate the host-tool error when the binary cannot run, while a ticket with no change / project without an `openspec` directory still returns `zeroStatus`.
- [x] 4.2 Make `validateForProposed`'s binary-failure message name the daemon's `PATH`.
- [x] 4.3 Test: `statusFor` errors (not empty artifacts) for a ticket whose change exists but the binary cannot run; it returns the zeroed status when there is no `openspec` directory.

## 5. Visibility

- [x] 5.1 Add a synchronous detection snapshot and `hostToolWarnings()` to `packages/core/src/tools/host.ts`, refreshed by a probe at startup and on a timer.
- [x] 5.2 Append the unavailable required/recommended tool lines to `warnings()` in `packages/core/src/briefing/service.ts`.
- [x] 5.3 Test: with `gh` unavailable the briefing warnings name `gh` and the daemon's `PATH`; once available the warning clears; a tool the daemon does not need produces none.

## 6. Host tools route

- [x] 6.1 Add `GET /api/daemon/host-tools` (detected tools + configured directories) and `PUT /api/daemon/host-tools` (persist `hostToolPaths`, re-apply resolution, clear the detection cache) in `packages/server/src/routes/daemon.ts`.
- [x] 6.2 Document both routes in `docs/API.md`.
- [x] 6.3 Test: PUT persists to `daemon.yaml` and a directory added there makes an otherwise-undiscovered fake tool detectable without a restart.

## 7. Web app

- [x] 7.1 Add `path` to `Health.host.tools` in `packages/ui/src/api/types.ts` and a `useDaemonHostTools`/query hook plus a `host-tools` section in `packages/ui/src/lib/settings.ts`.
- [x] 7.2 Add the Host tools section to `packages/ui/src/routes/Settings.tsx`: detected tools with availability and resolved path, and an editable `hostToolPaths` list.
- [x] 7.3 Add the daemon-wide host-tool notice to `packages/ui/src/app/AppShell.tsx`, linking to the section, shown while any required/recommended tool is unavailable.
- [x] 7.4 Test: the section renders the tools and saves a directory; the notice shows when a tool is unavailable and clears when it is not.

## 8. Verify and deliver

- [x] 8.1 Run `pnpm lint`, `pnpm typecheck`, and both test suites; paste the core/server and UI suite blocks verbatim in the report with their totals.
- [x] 8.2 Open the PR against `main`, record it as a work product, and transition to `in_review`.
