## Why

On 2026-11-02 the host's root filesystem reached 99 % (24 GB free of 1.6 TB) and the daemon died with `SIGBUS`. The largest single consumer was ours: 224 worker copies, 255 GB across two workspaces, kept because the landed-work check correctly refuses to remove unlanded work — and then does nothing else. Nothing ages them, nothing surfaces them, and nobody learns about them until the disk is full. The restart wake for that crash then reported a stale `downAt` and `shutdownReason: SIGTERM` from the process before, so the weaver could have told captain a confident 17-hour outage for a 3-second one.

## What Changes

- **Retained-copy report.** The daemon scans, per workspace, every worker copy it keeps (a `workers/` directory with a checkout whose worker is not live): worker, ticket, ticket status, project, branch, age, size on disk, and every reason it was not retired: uncommitted (tracked / untracked counts), commits not on the landing branch (count, and how many are on no remote), branch gone from the project clone, or unreadable. Per-workspace totals. The scan runs off the supervisor tick, one copy at a time, at least daily and on request, and changes nothing. Exposed as `GET /api/w/:ws/workers/retained`, `weave worker retained`, and a new workspace **Storage** view in the web app (there is no workspace overview page today; the workspace summary also gains the count and total).
- **Retention classes.** `open` (ticket not terminal, never offered), `finished_unlanded` (ticket `done`/`cancelled`, branch exists), `branch_gone` (ticket terminal, branch no longer in the clone, so only the copy's own files remain), `orphan` (no agent or no ticket). Age runs from the ticket's terminal time; a non-open copy is marked *offerable* at `defaults.retainedCopyOfferDays` (default 30). A class or an age never removes anything.
- **Reclaim is offered, never taken.** Captain selects copies in the Storage view (or `weave worker reclaim`). That raises human-owned `discard_approval` cards stating the bytes freed and what is lost; it removes nothing. A copy with any unpushed commit, or commits reachable only from the copy, gets its own card; copies without such commits may share one card. A reclaim removes the checkout and home and **keeps the branch and its commits in the project clone**. Only an `approve` from captain runs it — not auto-approval, not the weaver, not a relay — and it re-reads each copy first, refusing any that changed since the card. The daemon raises no reclaim card on its own: an automatic flood of 200 cards would bury Needs you, so the offer is the Storage view and the low-disk warning.
- **Low-disk warning.** A daemon-level timer (every 10 min) reads free space on the filesystem holding each workspace root through `fs.statfs`. Below `disk.warnFreePercent` (10 %) or `disk.warnFreeBytes` (50 GiB) it warns captain once per episode — a chat line on each affected workspace and one daemon incident — naming free/total space, the threshold, the five largest retained copies and each workspace's total, and pointing at the Storage view. Hysteresis ends the episode; a further halving re-warns.
- **Restart wake states the outage honestly.** A shutdown or reason recorded before the previous boot is never attributed to the previous process; a crash reports `downAt: null` (unknown) and no shutdown reason. The daemon records a liveness instant every minute and its systemd invocation id at boot; the next boot reports `lastAliveAt` as an upper bound and, where the journal holds the previous invocation's exit (`EXIT_CODE=dumped`, `EXIT_STATUS=7`, `UNIT_RESULT=core-dump`, `N_RESTARTS=1`), reports that exit and its time as `downAt`. The chat line and the weaver instructions say "unknown" when nothing is known.
- **Docs and KB.** `docs/OPERATIONS.md` ("Disk fills up", rewritten: what retained copies are, why kept, how captain reclaims), `docs/API.md`, `docs/CLI.md`, `docs/CONFIGURATION.md`; the KB document `worker-home-retention` gains the retained-copy section.

## Capabilities

### New Capabilities
- `worker-retained-copies`: reporting retained (unlanded) worker copies with sizes and reasons, their retention classes, and the approval-gated reclaim offer.
- `disk-space-warning`: the free-space check on the filesystems holding workspace roots and the warning to captain naming the top consumers.

### Modified Capabilities
- `daemon-restart/restart-announcement`: the lifecycle record no longer serves a shutdown from an earlier process; adds a liveness instant and the service-manager invocation id; the wake and chat line state the down time only when known, with the systemd-recorded exit where available; the weaver instructions forbid inventing an outage length.

## Impact

- `packages/core/src/workers/` (retained-copy scan and store, classes, reclaim offer and execution), `packages/core/src/decisions/service.ts` (a reclaim `discard_approval` executes on approve), `packages/core/src/supervisor/` (schedules the daily scan off-tick), `packages/db` (migration: `retained_copies` table), `packages/shared` (types, enums, config keys).
- `packages/server/src/restart-notice.ts`, `daemon.ts` (liveness heartbeat, invocation id, journal lookup, disk-space timer), new routes, `packages/cli` (`weave worker retained`, `weave worker reclaim`), `packages/ui` workspace Storage view.
- `templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md`.
- No new dependency. The journal lookup shells out to `journalctl` read-only, bounded by a timeout; absent `journalctl` the report degrades to unknown.
