## 1. Shared contracts and configuration

- [x] 1.1 Add `workerMemoryMb: number | null` (default `null`) to `WorkspaceDefaultsSchema` with a floor and an upper bound, and verify `WorkspaceConfigSchema.safeParse({})` yields `null` and that a below-floor value fails validation (`packages/shared/src/config.ts`).
- [x] 1.2 Add `memoryLimitMb: number | null` (default `null`) to `RoleSpecSchema`, persist it in the `roles` table (new migration) and in `role.yaml` via the roles service, and verify a round-trip role create/update preserves it (`packages/shared/src/config.ts`, `packages/db/src/migrations`, `packages/core/src/roles`).
- [x] 1.3 Add `'resource'` to `RUN_ERROR_FAMILIES` and `'system'` to `INCIDENT_REPORTER_KINDS`, and update any exhaustive family/reporter label maps so typecheck passes (`packages/shared/src/enums.ts` and its consumers).
- [x] 1.4 Implement and unit-test limit resolution with precedence role → workspace → derived, including the derivation `max(floor, floor(0.8 × base / maxConcurrentRuns))` and the readable source; verify each branch with a test (`packages/core/src/...` new resolver).

## 2. Worker memory containment

- [x] 2.1 Add a containment module that returns a plain spawn where no systemd user manager is reachable, and otherwise a `systemd-run --user --scope --slice=app.slice --unit=<sanitised run id>` prefix carrying `MemoryHigh`, `MemoryMax`, `MemorySwapMax=0`, `OOMPolicy=kill` and `ManagedOOMMemoryPressure=kill`; unit-test the command shape and the fallback decision on both yes/no inputs (`packages/runtime-sdk/src/containment.ts` + test).
- [x] 2.2 Route `spawnLines` through the containment module so every adapter's turn is scoped, and verify by test that `spawn` receives the `systemd-run` prefix when containment is on and the raw command when it is off (`packages/runtime-sdk/src/process.ts`).
- [x] 2.3 Stop a contained turn by stopping its scope (human interrupt, watchdog cut, boot-recovery orphan) with a plain-signal fallback on scope-less hosts; verify boot recovery targets the scope against a scratch scope and never the live unit (`packages/core/src/runs/engine.ts`, `packages/core/src/supervisor/index.ts`).
- [x] 2.4 Decide and record in code/tests whether the two raw `spawn` calls in the opencode and codex `compact.ts` helpers are routed through containment; verify the chosen behavior with a test (`packages/runtimes/opencode/src/compact.ts`, `packages/runtimes/codex/src/compact.ts`).

## 3. Memory-kill outcome, activity and incident

- [x] 3.1 Classify an unattributed SIGKILL/exit-137 as `worker_memory_limit`/`resource` only when the scope's peak reaches the limit or the cgroup OOM counter fired, reading the scope before it is reset; unit-test the memory-kill, human-cancel, shutdown and watchdog paths (`packages/core/src/runs/engine.ts`, `packages/runtime-sdk/src/containment.ts`).
- [x] 3.2 Make `'resource'` retryable and verify a memory kill schedules the normal backoff retry and that an exhausted budget parks the worker with the memory reason (`packages/core/src/runs/engine.ts` + engine test).
- [x] 3.3 Record an activity entry on every memory kill, scoped to the ticket and project and naming the peak; verify with a test asserting the row (`packages/core/src/events.ts`, engine test).
- [x] 3.4 File exactly one system incident on the second memory kill for the same ticket while none is open, naming the ticket, role and peak, and verify a first kill files none and a third while open files none (`packages/core/src/incidents`, engine test).
- [x] 3.5 Surface the new family/code and the peak in the run/ticket view-model with the existing pause/report plumbing; verify the label renders (`packages/render/src`, `packages/ui/src`).

## 4. Effective limit in Settings

- [x] 4.1 Expose the effective worker memory limit and its source through the workspace config read path (and the workspace PATCH write path already accepts `defaults.*`); verify with an API test that a set value reports source `workspace` and an unset one `derived` (`packages/server/src/routes`).
- [x] 4.2 Add the Settings → Workspace control to view, set and clear `defaults.workerMemoryMb`, with inline validation; verify with a component test for set, clear and invalid input (`packages/ui/src/v2/settings`).

## 5. Test-parallelism defaults and documentation

- [x] 5.1 Inject the default test-runner parallelism caps into a worker turn's environment only when the key is not already set, and verify a project's own value wins (`packages/runtime-sdk/src/launch.ts` and/or `packages/core/src/runs/engine.ts` + test).
- [x] 5.2 Document the injected caps, the variables, and how to raise them deliberately in the worker skill; verify the skill text names each variable (`skills/`).
- [x] 5.3 Document the new config keys, the effective-value endpoint and the containment behavior in `docs/PLAN.md` / `docs/API.md`; verify both name the keys and the endpoint.

## 6. Daemon unit and installer

- [x] 6.1 Add `ManagedOOMPreference=avoid` to `renderServiceUnit` and extend the installed-unit correction path so an existing host is corrected on upgrade with a best-effort reload; verify with unit tests on the rendered unit and the correction (`packages/cli/src/daemon.ts` + tests).

## 7. Prove it on a scratch unit

- [x] 7.1 Write an integration test that starts a memory hog inside a worker-shaped scope (uniquely named, scratch `XDG_CONFIG_HOME` where it isolates; uniquely named units because a scratch config dir does not isolate `systemctl --user`) and asserts the hog is killed while a daemon-shaped scope beside it keeps running; skip cleanly when no user manager is available, and never reference or signal the live `weave-ai.service` (`packages/core/test` or `packages/server/test`).
- [x] 7.2 Confirm the test guard does not let an ordinary `pnpm test` reach the live manager, and that the containment test deliberately uses a uniquely named transient scope rather than `realRun`; verify by running the suite with `AC_TEST_GUARD` set (`vitest.setup.ts`, the new test).
- [x] 7.3 Run `pnpm lint`, `pnpm typecheck`, and each full test suite once at the end (core/server and UI, capped parallelism, one at a time), and paste both suite blocks verbatim in the ticket.

## 8. Knowledge

- [x] 8.1 Record the verified oomd facts, the containment decision and the limit shape as a project knowledge entry (or one line on the existing hub) before finishing.
