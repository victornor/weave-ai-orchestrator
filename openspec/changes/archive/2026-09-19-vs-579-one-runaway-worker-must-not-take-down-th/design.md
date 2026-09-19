## Context

See `proposal.md` — Why. The daemon spawns every worker runtime turn through one function, `spawnLines` in `packages/runtime-sdk/src/process.ts:17`, called by each adapter's `runTurn`. It uses `child_process.spawn(..., { detached: true })` and kills with `process.kill(-pid)`. Nothing moves the child out of the daemon's control group, so every worker process tree lives in `weave-ai.service`'s cgroup. Two raw `spawn` calls bypass even `spawnLines` (`packages/runtimes/opencode/src/compact.ts`, `packages/runtimes/codex/src/compact.ts`).

Verified on this host (systemd 261.3, Arch; read-only):

- `systemd-oomd` is a **system** service, socket-activated and active. `oomctl` shows exactly two monitored cgroups, both `/user.slice/user-1000.slice/user@1000.service/app.slice`: memory pressure limit 50% / 20 s and swap limit 90%. The thresholds come from `/etc/systemd/oomd.conf.d/10-omarchy.conf`; the eligibility comes from `/etc/systemd/user/app.slice.d/10-oomd.conf`, which sets `ManagedOOMMemoryPressure=kill` and `ManagedOOMSwap=kill` on `app.slice`.
- Per `systemd-oomd.service(8)` and `systemd.resource-control(5)`: only **descendant** cgroups of a kill-marked cgroup are eligible candidates — the cgroup carrying the property is not itself a candidate — and only **leaf** cgroups (or cgroups with `memory.oom.group` set) are eligible. `oomd` selected `weave-ai.service` because it was a leaf descendant of `app.slice` holding the daemon **and all 358 worker processes**.
- `ManagedOOMPreference=avoid` is respected for memory-pressure candidates only when the unit's cgroup owner equals the monitored ancestor's owner. Here the monitored ancestor is `app.slice` (owner UID 1000) and the daemon unit is owned by UID 1000, so `avoid` on the daemon unit is respected. It is **not** respected for swap candidates on a non-root-owned cgroup, so `avoid` is a pressure-side safeguard, not a swap one.
- The user manager has the `memory` controller delegated: `/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/cgroup.controllers` is `cpu memory pids` and `cgroup.subtree_control` matches, so a user scope can enforce `MemoryMax`.
- `systemd-run --user --scope` is available. It runs the command as a child of `systemd-run` and is synchronous, returning when the command finishes, with the command's exit status propagated.
- The live unit is `Slice=app.slice`, `ManagedOOMPreference=none`, `MemoryHigh=infinity`, `MemoryMax=infinity`; `renderServiceUnit` (`packages/cli/src/daemon.ts:145`) sets none of these.

## Goals / Non-Goals

**Goals**
- A worker's memory use, however pathological, cannot end the daemon's process or any peer's turn.
- The limit is configurable, sensible by default, and legible in Settings.
- A memory kill is a first-class, retryable failure a human can see and act on.
- Default containment is on with no configuration, and the change is shipped by the product, not applied to one host.

**Non-Goals**
- Memory limits on non-worker agents or on the daemon itself.
- A per-project memory limit (the count is already bounded by project `maxWorkers`; a per-project override can be added later if a real need appears).
- CPU/IO isolation, or a change to how project `maxWorkers` / `maxConcurrentRuns` bound concurrency.
- Any drop-in on captain's host, or any execution against the live `weave-ai.service` / live systemd manager while testing.

## Decisions

### D1. Wrap the spawn seam in a transient scope, behind a small launcher module

The scope is created in a new module (for example `packages/runtime-sdk/src/containment.ts`) that `spawnLines` consults. It returns either a plain spawn (today's behavior) or a command prefix `systemd-run --user --scope --collect=no --slice=app.slice --unit=<name> -p MemoryHigh=… -p MemoryMax=… -p MemorySwapMax=0 -p OOMPolicy=kill -p ManagedOOMMemoryPressure=kill <cmd> …`.

- Keep the command prefix approach (`cmd`/`args`) rather than a second spawn path: every adapter already builds `BuiltCommand`, and a prefix keeps one spawn site, one stdout/stderr stream and one line parser.
- `--slice=app.slice` groups worker scopes with the daemon under the host's existing `app.slice` policy; without it, a `--user` transient unit defaults to the user manager's **root slice** and escapes that policy. `--slice-inherit` (systemd ≥ 246) is a refinement but `--slice=app.slice` is deterministic across versions and matches the daemon's own slice.
- The scope unit name is derived from the run id and sanitised (`ac-run-<runId>.scope`), so it is stable, collision-free and identifiable.
- The two raw `spawn` calls in the vendor `compact.ts` files are compaction helpers that fork the runtime CLI; they are routed through the same launcher if they can be, and otherwise left as-is (they are short-lived and not the runaway path) — a task records which.
- Alternative rejected: run the whole daemon in its own slice and cap *it*. That still kills the daemon and every peer when the slice is hit; it contains nothing per worker.
- Alternative rejected: cgroups written by hand under `/sys/fs/cgroup`. Not portable, fights systemd over ownership, and gives no unit to inspect or stop.

### D2. Limits and oomd settings

- `MemoryHigh = MemoryMax = L`: both at the worker's limit, so reaching it ends the tree. Verified on a scratch scope (systemd 261, 2026-09-19): with `MemoryHigh` below `MemoryMax` a reaching allocation is throttled and reclaims forever — the process stalls at the limit instead of being killed (timeout, no OOM). With the two equal it is OOM-killed deterministically (`exit 137`, `OOMKills=1`). So `MemoryHigh` at the hard cap is what makes the kill, not a stall.
- `MemorySwapMax=0`: a runaway worker must not push the host into swap. The incident was swap thrash; letting the worker swap would recreate it.
- `OOMPolicy=kill`: the kernel's `memory.oom.group=1` for a unit, so when one process in the scope is OOM-killed the whole scope is and systemd records the kill. There is no `MemoryOOMGroup=` property on systemd 261 — verified against a real scratch scope (`Unknown assignment`).
- `ManagedOOMMemoryPressure=kill` on the scope: `oomd` watches the worker's own PSI and can act on it before `app.slice`-wide pressure builds. The scope's pressure limit is left at the host default (inherit `oomd.conf`); it need not fire before `MemoryMax` to be useful.
- `ManagedOOMPreference=avoid` on the daemon's unit, added to `renderServiceUnit` and to the legacy-unit correction path, so `oomd` prefers a worker scope.
- Structural effect on this host: once workers are in their own scopes, `weave-ai.service` is no longer a leaf holding them, so it stops being an `oomd` candidate at all.

### D3. Classification: a new retryable `resource` error family

Add `'resource'` to `RUN_ERROR_FAMILIES` and to the engine's `RETRYABLE` list (today only `transient_upstream`), and classify a memory kill as `errorCode: 'worker_memory_limit'`, `errorFamily: 'resource'`. A `resource` failure then flows through the existing ladder (30 s / 2 min / 10 min, max 3) and, when spent, `parkForHuman`, unchanged.

- Alternative rejected: reuse `transient_upstream`. It is semantically wrong and shows the human "transient upstream failure".
- Alternative rejected: handle memory kills outside the family system. The ladder, `agentStatus` and parking are all keyed on the family; a special case would fork all three.

Detection: when the scope's child exits by signal (SIGKILL/exit 137) **and** it was not a human cancel, a daemon shutdown, or a watchdog cut (those are classified before it), the launcher reads the scope's peak memory and cgroup OOM event (`systemctl --user show <scope> -p MemoryPeak`, and the scope's `memory.events`/`memory.peak` while the cgroup exists). A peak at or above the throttle limit, or a non-zero OOM-kill counter, classifies it as `worker_memory_limit`; otherwise it keeps today's `interrupted`. `OOMPolicy=kill` makes the kernel path deterministic; the `oomd` pressure path has no kernel OOM counter and is attributed from the peak. A precise `oomd`-kill marker is a verification item, not an assumption.

The scope is not created with `--collect`, so its unit and `MemoryPeak` survive long enough to read; the launcher resets it after recording.

### D4. Configuration shape

- `workspace.defaults.workerMemoryMb: number | null`, default `null` = derive. Bounds: a floor (recommend 1024 MB) and at most total memory. `null` is deliberate so a machine upgrade changes the default instead of freezing a stale derived number.
- `RoleSpec.memoryLimitMb: number | null`, default `null` = inherit the workspace. Persisted in the `roles` table (new column + migration, mirroring `max_workers`) and in `role.yaml`.
- Precedence: role → workspace → derived. `os.totalmem()` is the base; if the daemon's own cgroup has a readable `memory.max`, that wins as the base (a daemon inside a container must not derive from the whole host).
- A new read endpoint/view returns the effective value and its source (`role` | `workspace` | `derived`), mirroring `WorkspaceModelsSource`.
- A `null`/absent role value on a live worker does not change a running turn; limits are resolved at spawn.

### D5. Default test-parallelism caps in the worker env

`childEnv`/the engine's env block adds defaults when the key is not already set: `VITEST_MAX_WORKERS` and `VITEST_MAX_THREADS`, `JEST_MAX_WORKERS` (and `--maxWorkers` guidance), and a bounded `UV_THREADPOOL_SIZE`. They are *defaults*, so a project's own value wins. The worker skill documents them and how to raise a cap deliberately. This is a mitigation that lives beside the cgroup limit, not a substitute for it.

### D6. Repeat offender files one incident

Add `'system'` to `INCIDENT_REPORTER_KINDS` for daemon-filed incidents (the service already requires an `agentId`/`runId`, which the engine has). The engine records an activity entry (`worker.memory_limit`, scoped to the ticket and project) on every kill, and files one incident when a second memory kill lands for the same ticket while no memory incident for it is open; the incident names the ticket, the role and the peak. Filing never suppresses the ladder or the parking path.

## Open choices (with recommendations)

1. **Default limit.** Recommend deriving `max(1024 MB, floor(0.8 × baseMemory / maxConcurrentRuns))`; on this 60 GB host with `maxConcurrentRuns = 6` that is ~8.2 GB per worker. Rationale: the sum of simultaneous workers stays within 80% of memory, leaving the daemon, knowledge scans and the desktop headroom, while 8 GB fits a full vitest suite. Alternatives: a flat 4 GB (too tight for this repo's suite), or a per-core share (ignores that the runaway is one process tree, not the core count).
2. **Per-role override shape.** Recommend `RoleSpec.memoryLimitMb: number | null` (null = inherit), stored as a column and in `role.yaml`, editable through the existing role tools. Alternatives: a percentage of workspace, or a full limits object (`high`/`max`/`swap`) — both add surface before a need is shown.
3. **Repeat offender.** Recommend the ladder handles it automatically (it already does once `resource` is retryable), an activity entry on every kill, and **one** incident on the second kill on the same ticket, deduplicated by an open incident. Alternatives: an incident on the first kill (noisy — one heavy test run is not an incident), or parking on the first repeat (too eager; the ladder's own budget is the judgment).

## Risks / Trade-offs

- **A legitimate heavy build is throttled or killed by a limit that is too low** → the derived default leaves 80% of memory to workers and a 1 GB floor; the first retry usually passes because a cache is warm; the human can raise the workspace or role limit; the failure is clearly labelled.
- **`systemd-run` changes the direct child, breaking `pid`/`pgid` kills and boot recovery** → cancellation and orphan cleanup target the scope (D1); a task verifies boot recovery against a scratch scope; scope-less hosts keep the pgid path.
- **`systemd-run` may not propagate a signal death faithfully** → the launcher reads the scope's own exit/peak rather than trusting `systemd-run`'s code; verified in the integration test.
- **A wrong memory classification** → classification is gated on an unattributed SIGKILL *and* a peak at/above the limit; human cancels, shutdowns and watchdog cuts are classified first and never reach it. A test pins each.
- **`--slice=app.slice` assumes the daemon is in `app.slice`** → true for a systemd user service and for the live unit; the launcher can fall back to no `--slice` (user root slice) if the slice is unavailable, still monitored because the scope itself is marked kill.
- **`MemoryOOMPreference=avoid` on a host that installed before this change stays inert until the unit is re-rendered/reloaded** → `renderServiceUnit` covers new installs; the existing `ensureUnitRestartAlways` correction path is extended so an upgrade corrects it too, with the same best-effort reload.
- **Incident noise** → deduplicated while one is open; only the second kill on a ticket files.

## Migration Plan

1. Land the config/enum/migration additions first (additive, no behavior change while `workerMemoryMb` is `null`).
2. Land containment + classification behind the launcher; on a host with a user manager, worker scopes begin immediately at spawn. No daemon restart is required by the code, but the `ManagedOOMPreference=avoid` unit line takes effect only after `weave daemon install-service` / the next unit correction and `daemon-reload` — the CLI already prints that follow-up.
3. Rollback: removing the containment code returns `spawnLines` to a plain spawn. Config keys are additive; an old daemon ignores them. The unit line is inert on an old daemon.

## Open Questions

- Whether `systemd-run`'s exit-status/ signal propagation is faithful enough to classify without consulting `systemctl show`, or whether the launcher must always read the scope. Resolve during the integration test; either way the spec's classification holds.
