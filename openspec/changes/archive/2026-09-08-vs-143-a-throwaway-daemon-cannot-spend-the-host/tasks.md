## 1. Isolation determination and plumbing

- [x] 1.1 Add `workspaceLoader.isDefaultConfigDir(resolved: string): boolean` (`packages/core/src/workspace/loader.ts`), comparing against the same default-resolution precedence `configDir()` already implements (`AC_CONFIG_HOME` → `XDG_CONFIG_HOME/agent-conductor` → `~/.config/agent-conductor`). Verify with a unit test covering each override.
- [x] 1.2 Add `--share-host-credentials` to `packages/server/src/bin.ts`'s flag parsing and `AC_SHARE_HOST_CREDENTIALS` as its env equivalent; thread `shareHostCredentials` into `startDaemon()`'s options (`packages/server/src/daemon.ts`). Verify `bin.ts`'s flag parsing test (or a new one) covers both forms.
- [x] 1.3 In `daemon.ts`, compute `isolated = !isDefaultConfigDir(configDir) && !shareHostCredentials` once at startup and add `isolated: boolean` to `WorkspaceContext` (`packages/core/src/context.ts`), set from this value for every workspace the daemon constructs. Verify a test constructing a `WorkspaceContext` (or `startDaemon`) with a custom `configDir` sees `isolated: true`, and with the default `configDir` sees `isolated: false`.

## 2. Credential isolation (design.md D3)

- [x] 2.1 Change `credentialPaths()` (`packages/core/src/workspace/loader.ts`) to take the daemon's `configDir` and `isolated` flag instead of reading `process.env.HOME` unconditionally: non-isolated keeps today's `~/.claude/...`-style host path per runtime; isolated resolves to `<configDir>/credentials/<runtimeId>/.credentials.json`. Verify with a unit test asserting the two resolved paths for the same runtime differ between isolated and non-isolated, and that isolated never produces a path under the real `$HOME`.
- [x] 2.2 Update `linkRuntimeCredentials()`/`reconcileOne()` call sites to pass the resolved isolated/non-isolated host path through unchanged otherwise (symlink + expiry-based reconcile logic stays the same). Verify the existing `packages/core/src/workspace/credentials.test.ts` suite still passes, extended with a case for two different daemons (default `HOME` vs. a fake isolated `configDir`) that must resolve to two distinct, non-conflicting credential files for the same runtime id.
- [x] 2.3 Verify (test) that a runtime with no credential yet under an isolated `configDir` reports "needs a login" rather than silently reading the real host file — i.e., the isolated path is genuinely inert until someone logs it in.

## 3. Dispatch gate (design.md D4)

- [x] 3.1 Add a helper that, given an agent's queued `Wakeup` rows (flattened through the same bundle-aware logic `flattenWakes` already uses), answers whether any of them was `requestedBy: { kind: 'human' }`. Verify with a unit test covering a bare human-requested wake, a system-requested wake, and a system-requested wake with a human-requested entry coalesced into its bundle.
- [x] 3.2 In `packages/core/src/runs/dispatcher.ts`'s `tick()`, when `ctx.isolated` is true, skip a candidate agent whose queued wake-ups do not include a human-requested one (per 3.1), leaving those wake-ups `queued`. Verify with a dispatcher test: an isolated context with a system-requested wake queued spawns no run; the same context with a human-requested wake queued (alone, or alongside the system one) does.
- [x] 3.3 Verify (integration-level test in `packages/core`) that adding a project to an isolated workspace creates the scout ticket and the conductor's `project_added` wake as today, but spawns no run for either, per `daemon-isolation/dispatch-gate`'s "Adding a project does not dispatch" scenario.
- [x] 3.4 Verify (test) that `shareHostCredentials: true` makes an otherwise-isolated context behave exactly as non-isolated for both credential resolution (task 2) and dispatch (this task) — one flag, both behaviors.

## 4. Documentation and knowledge

- [x] 4.1 Correct `CLAUDE.md`'s "Test against throwaway daemons only" bullet to state what `--config-dir` now isolates (the runtime credential, and autonomous dispatch) by default, and how `--share-host-credentials` opts out of that — so the next reader of this practice knows both what changed and what a throwaway daemon still cannot do (it still must not touch the live install).
- [x] 4.2 On the merge turn, record one project-knowledge entry (or update the existing 2026-09-08 landmine referencing this ticket) stating the fix landed: a daemon started with a non-default config dir isolates its runtime credentials and does not autonomously dispatch runs by default, with the opt-in name, per `agent-conductor-knowledge`.

## 5. Verification

- [x] 5.1 `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass.
- [x] 5.2 `openspec validate vs-143-a-throwaway-daemon-cannot-spend-the-host --strict` passes.
- [x] 5.3 State in the PR description exactly what an isolated daemon now shares with the host (nothing, for credentials and dispatch, unless `--share-host-credentials`/`AC_SHARE_HOST_CREDENTIALS` is given) and what it does not, per the ticket's verification requirement.
