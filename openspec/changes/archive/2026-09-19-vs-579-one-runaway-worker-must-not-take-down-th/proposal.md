## Why

On 2026-09-19 at 16:24 local, `systemd-oomd` killed the whole `weave-ai.service` unit ("killed 358 process(es) in this unit", `Failed with result 'oom-kill'`) because one worker's `pnpm test` / vitest run drove the unit's cgroup to 43.2 GB of 60 GB and held `app.slice` under memory pressure. The daemon restarted three seconds later, but every running worker turn and every child process died with it. The daemon and every worker it spawns share one cgroup, so the unit is the blast radius of any worker's memory use — a test run, a build, an ffmpeg or a browser. The trigger will recur; the containment must not.

## What Changes

- **Run each worker turn inside its own transient systemd scope.** The runtime process tree leaves the daemon's cgroup, so an out-of-memory kill takes the worker, not the daemon and every peer. Where a systemd user manager is available, the scope is created with `MemoryHigh`, `MemoryMax`, swap containment, `ManagedOOMMemoryPressure=kill` and `OOMPolicy=kill`; the daemon's own unit is rendered with `ManagedOOMPreference=avoid`. Where there is no user manager (macOS, containers, other init), the launcher falls back to today's behaviour and logs a notice.
- **Make the limits configuration.** A workspace default with a machine-derived value, overridable per role; the effective value and its source are readable and editable in Settings. A sensible default derives from total memory divided by the run concurrency so the sum of worker limits cannot exceed the machine.
- **Surface a memory kill as a memory kill.** A worker killed for memory ends its run as `failed` with a clear reason and its peak memory, not as an ambiguous `interrupted` turn; it is resumable by the existing retry ladder. Each kill records an activity entry, and a repeat offender files a daemon incident naming the ticket and the peak.
- **Guard test-runner parallelism by default.** A worker's environment carries defaults that cap common runners (vitest, jest, dotnet) so a full suite cannot spawn one thread per core; documented in the worker skill.
- **Prove containment on a scratch unit.** An integration test runs a memory hog inside a worker-shaped scope and asserts the hog is killed while a daemon-shaped scope beside it survives — never touching the live unit.

## Capabilities

### New Capabilities
- `runtime-launch/worker-memory-containment`: each worker turn runs in its own systemd scope with memory limits, oomd settings and swap containment; the daemon unit is marked avoid; there is a clean, logged fallback where systemd is unavailable.
- `runtime-launch/worker-memory-limits`: how the limits are configured, derived from the machine, overridden per role, and resolved and reported as an effective value.
- `runtime-launch/worker-test-parallelism`: per-worker environment defaults that cap test runners' parallelism, and their documentation.
- `worker-supervision/worker-memory-kill`: a memory-killed run's outcome, its activity entry, the incident filed when it repeats, and its resumption through the retry ladder.
- `web-settings/worker-memory-limits`: Settings shows the effective worker memory limit and lets the human set the workspace default.

### Modified Capabilities
<!-- None: existing requirements are unchanged; the memory-kill outcome plugs into the existing retry ladder. -->

## Impact

- **Runtime launch**: `packages/runtime-sdk/src/process.ts` (the single turn-spawn choke point) and `packages/runtime-sdk/src/launch.ts` (child env), plus the two raw `spawn` calls in `packages/runtimes/opencode/src/compact.ts` and `packages/runtimes/codex/src/compact.ts` stay in-cgroup unless also routed through the launcher.
- **Run engine / supervisor**: `packages/core/src/runs/engine.ts` (spawn, classification, retry), `packages/core/src/supervisor/index.ts` (boot recovery and any orphan-kill now targets a scope, not a pgid).
- **Shared contracts**: `packages/shared/src/config.ts` (workspace default + `RoleSpec`), `packages/shared/src/enums.ts` (a run error family for resource kills, and a system incident reporter), `packages/shared/src/events.ts`/`activity`.
- **Daemon lifecycle**: `packages/cli/src/daemon.ts` `renderServiceUnit` (and the legacy-unit rewrite path) gains `ManagedOOMPreference=avoid`; `packages/db` gains a migration for the role override.
- **Incidents**: `packages/core/src/incidents` gains a daemon-filed (system) reporter path.
- **Web UI**: `packages/ui/src/v2/settings` gains a worker-memory section.
- **Docs and skills**: `docs/API.md`, `docs/PLAN.md`, `skills/` (the worker skill's test-parallelism guidance), and the knowledge base landmine entry.
