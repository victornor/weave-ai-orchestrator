## Why

`weave_worker_cancel` correctly parks a cancelled worker at agent `status: 'done'` (the same
intentional, standing terminal-ish state a normally-finished-but-unlanded worker reaches per
VS-333 — its worktree is kept, not archived, until the work lands or a human discards it). But
`stalledWorkers()` in the supervisor only excludes agent `status != 'retired'`; it does not
recognize `'done'` as terminal too. A cancelled (or otherwise `done`) worker with an open ticket
therefore keeps matching the stall query forever, so the stall watchdog re-raises the same
`gate_finding` decision on it every ~3 minutes indefinitely, waking the weaver for a finding it
already answered. This happened live on 2026-09-23 (VS-680's cancelled worker), five times over
eleven minutes before the incident was filed.

## What Changes

- The stalled-worker detection query excludes any agent whose own `status` is `done`, not only
  `retired` — a worker already at a standing terminal-ish state can never regain a source of a
  future wake on its own and must never be flagged, nudged, or escalated.
- No change to `weave_worker_cancel`'s handler: leaving a cancelled worker at `status: 'done'`
  (worktree kept, ticket left as-is) matches the existing, intentional `done` semantics
  documented at VS-333, and is not the bug.

## Capabilities

### Modified Capabilities
- `worker-supervision/stalled-worker-detection`: the "worker with no possible source of a future
  wake" requirement's exclusion list gains the agent's own `done` status, alongside the existing
  `retired` exclusion; a new scenario covers a cancelled worker specifically.

## Impact

- `packages/core/src/supervisor/index.ts` — `stalledWorkers()`'s SQL `WHERE` clause.
- Regression tests in `packages/core/src/supervisor/*.test.ts` (or wherever the existing stall
  detection tests live): one for a normal-completion `done` worker, one for a cancelled worker,
  both asserting no `gate_finding` / recovery wake is produced once the stall sweep runs again.
- No API, schema, or CLI surface changes.
