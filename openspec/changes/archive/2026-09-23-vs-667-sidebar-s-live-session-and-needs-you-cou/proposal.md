## Why

The sidebar's two counters — **Live** (working workers) and **Needs you** (open human decisions) — are
built from react-query reads that live-event invalidation does not actually reach, so they drift from
the real state and only correct when the human opens the screen behind them.

The stream plumbing added by VS-630/VS-641 is in place (one daemon-wide SSE per document, reachable
from every page), so the counter rules were assumed live. They are not, for two independent reasons:

1. **The live count reads `agents.status`, but the events that move it are not emitted.** The run
   engine writes `agents.status = 'running'` and then emits `run.started` — an event whose invalidation
   list touches `runs` and the weaver, never `workers`. The `worker.status` event that would invalidate
   the worker list is emitted in `workers/index.ts` only on resume, pause, done and retire, and the
   supervisor's own transitions back to `'active'` after a boot recovery or a watchdog kill
   (`supervisor/index.ts:231`, `:342`) emit no event at all. So a worker starting a turn raises no
   worker-list invalidation, and the rail's Live count stays low until something else forces a read.

2. **The per-workspace decision fan-out is never invalidated by an event.** `useV2Counts` counts the
   rail's and every workspace group's Needs-you figures from the *parameterised* decisions queries
   `useDecisionsMany(ids, { status: 'open', owner: 'human' })`. `invalidateFor` calls
   `inv(qk.decisions(ws))`, which never invalidates a parameterised key under it, and its synchronous
   `patchDecisionCaches` deliberately skips `status: 'open'` lists: an answer, a supersede, an expiry
   or a YOLO auto-grant removes the card from the cache without raising the count. The global
   Everywhere figure survives only because its `qk.workspaces()` sibling happens to be invalidated.

The second reason reproduces captain's report exactly in both directions: a YOLO/granted decision
leaves the badge high until the Needs you screen's own read reconciles it, and a decision created
elsewhere leaves a per-workspace row low.

## What Changes

- Emit `worker.status` wherever a worker's live-readiness changes without one today: the run engine's
  transition to `'running'`, and the supervisor's two recoveries back to `'active'`.
- Make the rail's Live and Needs-you counts converge from the daemon-wide stream as well: a frame that
  carries no workspace sequence (`seq === 0`, the `worker.activity` summary and `run.event`/`run.delta`)
  still identifies a workspace and a working agent, so a consumer mounted from a global page can
  reconcile that workspace's worker read when a worker joins or leaves the working set.
- Extract the rail's count derivation into a pure, testable function taking the loaded data, so the
  two counters' rules are asserted directly rather than through a mocked hook tree.
- No visual change: the count display, the rows and the layout are untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-v2/live`: the "rail's Live badge and the floor's figure are one derivation" requirement gains
  the live-readiness event contract it depends on — the badge SHALL be moved by a worker becoming or
  ceasing to be live, whichever code path changes that, without the Live page being opened.
- `web-v2/navigation`: the "rail's counts are live on every signed-in page" requirement gains the
  Needs-you direction it currently states only for creation: an answer, a supersede, an expiry or a
  grant that closes a decision SHALL drop the rail's count, and a per-workspace row SHALL move, not
  only the Everywhere figure.

## Impact

- `packages/core/src/runs/engine.ts`, `packages/core/src/supervisor/index.ts`: two missing
  `worker.status` emissions; no schema or API change.
- `packages/ui/src/v2/V2Page.tsx`: the count derivation, plus the seq-0 reconciliation.
- `packages/ui/src/api/events.ts`: `invalidateFor` cannot invalidate the parameterised decision lists
  (documented, not fixed there — the count no longer depends on it).
- Tests: `packages/ui/src/test/v2raillive.test.tsx` and new unit coverage for the extracted
  derivation.
- No route, tool, migration or config change.