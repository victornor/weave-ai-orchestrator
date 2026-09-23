## Context

See `proposal.md — Why`.

The rail's two counters come from `useV2Counts` (`packages/ui/src/v2/V2Page.tsx`), which reads
`useWorkersMany(ids)` and `useDecisionsMany(ids, { status: 'open', owner: 'human' })` and derives the
badges with `liveCounts`/`useRunningWorkerIds` (`packages/ui/src/lib/liveOrder.ts`). Those reads are
invalidation-driven: an SSE frame reaches `invalidateFor` (`packages/ui/src/api/events.ts`) which
marks query keys stale, and the mounted observers refetch.

Two facts about the existing code drive the design:

- `invalidateFor('worker.spawned' | 'worker.status' | 'worker.retired' | 'worker.stalled' |
  'worker.relaunched')` invalidates `qk.workers(ws)`; `run.started`/`run.finished` do not. A worker
  moving between `'active'` and `'running'` is a live-status change, not a run-list change.
- `invalidateFor('decision.*')` invalidates the *base* `qk.decisions(ws)` and calls
  `patchDecisionCaches`, which deliberately skips any list whose `status` includes only `'open'`. The
  rail reads a `status: 'open'` list, so the counter does not move on an answer/supersede/expiry.

The daemon-wide stream can only invalidate the workspaces it has `workspaceId`s for; it is not a query
observer. A `seq === 0` frame (the `worker.activity` summary) carries a `workspaceId` but no replay
position.

## Goals / Non-Goals

**Goals**

- The rail's Live count moves when a worker becomes or stops being live, whichever daemon code path
  caused it, from events alone.
- The rail's Needs-you count moves when a decision becomes open and when it closes, on both the
  Everywhere figure and each workspace's own row.
- Both rules are unit-testable without rendering the shell or mocking the whole hook surface.

**Non-Goals**

- No change to the count display, the rail rows, polling intervals or the number of connections.
- No fix to `invalidateFor`'s decision-list semantics generally (the parameterised-list gap is
  documented, not widened); the count stops depending on it instead.
- No new event type, route, schema or tool.

## Decisions

### 1. Emit the worker-status events where the status actually moves

The clean fix is upstream, not in the client: a worker's live-readiness is a domain fact and its
event belongs beside the write.

- `runs/engine.ts`, after `UPDATE agents SET status = 'running'` and before/with `run.started`, emit
  `worker.status` with `{ status: 'running', runtimeId, ticketId }`. `run.started`'s invalidation of
  `qk.workers(ws)` already covers the read; this makes the status move visible to every consumer that
  keys on the worker itself and keeps the two events consistent.
- `supervisor/index.ts` boot recovery and watchdog-kill recovery, where `agents.status` is set back to
  `'active'`, emit `worker.status` with `{ status: 'active', reason }` — matching the reason strings
  the other resume paths already use.

Alternative considered: emit only `run.started`/`run.finished` and make the client key the Live badge
on runs. Rejected — the badge is defined on the worker's live status (it must survive a turn boundary
via the grace), and the supervisor recoveries produce no run event at all.

### 2. The count derivation becomes a pure function

Extract the body of `useV2Counts` after its hook calls into a pure function, e.g.
`deriveV2Counts({ listed, decisions, workers, workingIds, incidents })` returning `V2Counts`. The hook
becomes a thin wrapper. This lets a test assert the two counting rules — including the per-workspace
direction and `countsAsNeeds` — with plain data, the same way `liveCounts` is already tested.

Alternative considered: keep the hook and test through the full `V2Shell` mock tree. Rejected for the
counting rules specifically: it couples a unit rule to a large mock surface, and VS-630's own live test
already covers the stream path.

### 3. Reconcile from the daemon-wide stream on a seq-0 frame, mounted from global pages

The one remaining gap the events cannot close: on a **global** page there is no workspace
`WorkspaceProvider`, so a workspace's `worker.activity` summary frame (seq 0) is forwarded but
invalidates nothing, and a worker that starts/stops while a global page is open would need its
workspace read refreshed by a frame that carries no sequence.

Add a small consumer in the shell, mounted only when the scope is global, that subscribes with
`useWorkspaceEvents`, and on a `worker.activity`/`run.event` frame for workspace `ws` invalidates
`qk.workers(ws)` at most once per coalescing window (the same rAF-coalesced pattern
`api/workerActivity.ts` uses). Scope the read to the frame's own `workspaceId`.

Alternative considered: widen the server's global stream to attach sequences to summaries. Rejected —
the summary is explicitly live-only by design (VS-328), and this adds protocol surface for one client
convenience.

### 4. Needs-you: keep the count on the `status: 'open'` read, close the invalidation gap

The count already reads the right list; the gap is that an event cannot invalidate it. Two candidate
fixes:

- (a) invalidate the parameterised key explicitly in `invalidateFor` (pass the same params object), and
- (b) have `patchDecisionCaches` also patch `status: 'open'` lists by *adding* a matching open decision
  and removing a closing one.

**Decision: (a) only**, because the removed-from-cache case already works for the list-rendering
screens and (b) changes the semantics VS-140/VS-369 deliberately chose (open lists are reconciled by
the refetch, not patched). The count does not need (b): on a decision event, the `status: 'open'` read
is invalidated explicitly and refetches. This keeps the fix to one line in `invalidateFor` plus its
test.

Alternative considered: count Needs-you from `qk.workspaces()` (`w.needsYou`) and let the existing
60 s refetch cover it. Rejected — that is a poll, and the ticket asks for real-time.

## Risks / Trade-offs

- **Extra worker-list refetches.** Emitting `worker.status` on run start, and reconciling per
  `worker.activity` frame on global pages, adds refetches. Mitigation: the count's read is one
  per-workspace list already refreshed on every `run.started`; the seq-0 reconciliation is
  raf-coalesced and only on global pages.
- **The `worker.status` on run start may briefly double-invalidate with `run.started`.** Harmless:
  TanStack merges concurrent invalidations for one key, and both are already emitted adjacently.
- **Global-page seq-0 reconciliation could refetch on a workspace that is idle.** Mitigation: key on
  the frame's `workspaceId` and skip when the workspace has no loaded worker read.
- **Event-less recoveries elsewhere.** Any future `agents.status` write without an event reopens the
  same class of bug; the spec now states the contract explicitly so a review can catch it.

## Migration Plan

No migration. The change is source-only; no data, config or route change. Rollback is a revert of the
two commits.

## Open Questions

None. The counting rules and the event contract are settled by the specs; the reconciliation's
coalescing window is an implementation detail that does not change them.