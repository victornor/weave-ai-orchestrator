## Context

See `proposal.md` — Why. Ground truth verified against this worktree (`main` @ 0275744):

- **The data V2 needs already exists.** `GET /workers` returns `WorkerListItem[]`, each carrying
  `activity: { verb, label, target, since } | null` and `tests: { passed, total } | null`
  (`packages/ui/src/api/hooks.ts:620-628`, `packages/shared/src/types.ts:131-143`). The daemon derives
  them in `WorkerActivityService` and pushes updates on the workspace stream as the ephemeral
  `worker.activity` frame (`packages/core/src/activity/index.ts:64-75`).
- **V1's board already knows how to consume it.** `packages/ui/src/routes/Board.tsx:97-131` keeps a
  `liveSummaries` map patched by `worker.activity` frames, coalesced per animation frame, and its
  `summaryOf(worker)` returns `override ? override.activity : worker.activity ?? null` — a pushed
  frame wins entirely, *including when its `activity` is null* (the turn ended, so the query's older
  line is stale). `TicketCard`'s `ActivityLine` (`packages/ui/src/components/TicketCard.tsx:68-83`) is
  the existing rendering: a recessed mono row with the pulsing working glyph (`StatusGlyph
  status="working"`, the amber hue per HANDOFF §2), the label and a live elapsed suffix; `TestTally`
  (`:86-90`) is the existing `passed/total tests` badge.
- **V1's project Work section shows the run-summary fallback.** `routes/project/WorkSection.tsx:20-26`
  and `v2/project/sections.tsx:120,141` render `lastLinesByAgent(runs).get(worker.id)` under the
  worker when live; `lastLinesByAgent` (`packages/ui/src/lib/projectOverview.ts:36-44`) is the pure
  "newest run with a summary, per agent" helper.
- **The stream never delivers the frame.** `EventStream.open()` attaches named listeners only for the
  types in its `TRACKED` array (`packages/ui/src/api/events.ts:145,162-209`); the server always sends
  `event: <type>` (`packages/server/src/routes/events.ts:31,35`), and `EventSource.onmessage` fires
  only for unnamed frames. `TRACKED` omits `worker.activity`, so V1's `useWorkspaceEvents` listener
  for it is dead in production and the board only ever sees activity refreshed at run/worker
  lifecycle events (which invalidate `qk.workers`). VS-328's own test bypasses the stream with
  `state.onEvent?.(...)` (`boardRoute.test.tsx:233`), so the gap was never caught. This affects V2
  identically: any V2 implementation that subscribes the same way is inert without this fix.
- **V2 Work today.** `v2/work/Work.tsx:89-116` already computes `live` via `liveWorkersByTicket` and
  puts `workerName` on each `WorkRow`, but renders no activity; it reads `useWorkers({})` and never
  `useRuns`. `v2/work/board.ts` folds columns. The V2 ticket page (`v2/ticket/Ticket.tsx:114-124`)
  derives `ui = ticketUiStatus(ticket.status)` and streams a run only after the user expands it.
- **Design constraints.** HANDOFF §2: hue only where work is live (`working` amber). HANDOFF §7: no
  *status* glyph on a kanban card or column header (the column states the status) — the working mark
  here is a liveness mark, matching V1's `ActivityLine`, not the ticket-status glyph.

## Goals / Non-Goals

**Goals:**
- Work cards, table rows and the phone list show a live worker's working mark and current activity,
  with the test tally, updating live from the existing stream.
- The V2 ticket page shows the same, near the top, without opening a run.
- One shared model so Work and the ticket page cannot disagree, reusing V1's helpers and components.
- No new API, route, event type or daemon behaviour; V1's screens keep working.

**Non-Goals:**
- Redesigning V1's board or project Work section. The only V1-visible effect is that its *existing*
  `worker.activity` listener starts receiving the frame it was already written to consume (Decision 2).
- A per-card run-event stream (`useRunEventStream` per card) — explicitly avoided, as on V1.
- Rendering the worker's full transcript, run history or usage on Work.
- Any change to how the daemon derives, stores or broadcasts `WorkerActivitySummary`.

## Decisions

### 1. One merged live model, reused by both V2 screens

New pure module `packages/ui/src/lib/workerActivity.ts`:

```ts
export interface WorkerLiveSummary {
  activity: WorkerActivitySummary['activity'];
  tests: TestTally | null;
}

/** The pushed frame wins over the workers-read row, including when its activity is null. */
export function mergeWorkerActivity(
  worker: { id: string; activity?: WorkerActivitySummary['activity']; tests?: TestTally | null } | null | undefined,
  pushed: ReadonlyMap<string, WorkerActivitySummary>,
): WorkerLiveSummary | null;   // null when there is no worker

/** The line to render: the current activity, else the worker's latest run summary, else null. */
export function activityLine(
  summary: WorkerLiveSummary | null,
  lastRunSummary: string | null,
): { label: string; since: string | null } | null;
```

`mergeWorkerActivity` returns the pushed frame's `activity`/`tests` verbatim when the map has the
worker, otherwise the worker's own fields (same rule as V1's inline `summaryOf`). `activityLine`
prefers `activity.label` (with `since` driving the elapsed suffix) and falls back to the run summary
rendered as a plain line with no elapsed clock.

A hook in `packages/ui/src/api/workerActivity.ts` subscribes with `useWorkspaceEvents`, buffers frames
into a `Map<agentId, WorkerActivitySummary>`, and flushes once per animation frame exactly as
`Board.tsx` does — so a burst of tool calls cannot re-render a board many times a second, and no run
stream is opened per card. Both `v2/work/Work.tsx` and `v2/ticket/Ticket.tsx` use it.

**Alternative considered:** duplicate V1's inline merge in each screen. Rejected — two copies of the
same precedence rule is how the two surfaces drift; the pure helper is trivially testable.

### 2. Deliver the ephemeral frame: add `worker.activity` to `TRACKED`

`packages/ui/src/api/events.ts`'s `TRACKED` gains `'worker.activity'`. Its declared type widens to
`(EventType | EphemeralEventType)[]`, since `worker.activity` lives in `EPHEMERAL_EVENT_TYPES`, not
`EVENT_TYPES` (`packages/shared/src/events.ts:22`). `invalidateFor` needs no case: its `default` is a
no-op, and the frame is applied by the component listener, not by query invalidation. The frame
carries `seq: 0`, so it does not move a client's replay cursor (`events.ts:155` guards with
`Math.max`).

This is the smallest change that makes the ticket's "updates live from the existing event stream" true
for *any* subscriber. Without it V2's live update would be dead in production while a mocked unit
test stayed green — the exact failure mode the board has carried since VS-328.

**Effect on V1 (flagged for the reviewer):** V1's board already registers a `worker.activity`
listener (`Board.tsx:104`); adding the type to `TRACKED` makes that listener fire, so V1's board
begins updating mid-turn as VS-328 intended. No V1 code, layout or data changes; the acceptance's
"V1 is unchanged" is read as "V1's screens are not redesigned or broken". If the reviewer wants the
V1-visible change avoided, the alternative is a V2-only subscriber, which means duplicating the
stream machinery or opening a second connection — both worse.

### 3. Card anatomy: the working mark is a liveness mark, not a status glyph

HANDOFF §7 bans the *status* glyph on a kanban card and column header because the column already
states the status. The working mark the ticket asks for is the amber `working` glyph that
`ActivityLine` already renders beside a worker's current activity — the same "hue only where work is
live" rule as HANDOFF §2, and identical to what V1's board shows on a live card. It appears on the
line row, not as a status indicator in the card's top row.

On a kanban card the line renders above the worker/age hairline, mirroring `TicketCard`'s placement;
on table rows and the phone list it renders under the title. The test tally renders as the existing
`TestTally` badge among the card's tags. The precedence on a card, per ticket:

- live worker with a current activity → working mark + `activity.label` (+ elapsed) + tally;
- live worker between turns with a run summary → the summary as a plain line (no elapsed) + tally;
- live worker with neither → the working mark alone;
- paused worker → `paused · <reason>` via `workerPauseDetail`, no working mark;
- otherwise → nothing.

### 4. The ticket page marks liveness the same way V1's board does

The header's glyph currently uses `ticketUiStatus(ticket.status)`, which shows `idle` for a `todo`
change ticket even while a worker is live on its propose turn. It switches to
`ticketBoardStatus(ticket.status, { live })` (`lib/board.ts:117-129`), so a live worker reads as
`working`, and the same activity line renders under the metadata row. Liveness and the summary come
from the same `useWorkerActivity`/`mergeWorkerActivity` pair the Work screen uses, found by the
ticket's worker id, so the two surfaces cannot disagree.

### 5. Reuse the existing rendering primitives

`ActivityLine` and `TestTally` (`components/TicketCard.tsx`) render the line, glyph, elapsed clock and
tally exactly as V1 does — reusing them guarantees the "same data behaviour as V1's last line" the
acceptance asks for, rather than a second look-alike. The run-summary fallback uses a plain recessed
mono line (no pulse) so it is not mistaken for a live activity.

## Risks / Trade-offs

- [Two surfaces could drift from V1's rule] → one pure `mergeWorkerActivity`/`activityLine` pair, unit
  tested, used by both V2 screens; `ActivityLine`/`TestTally` are literally V1's components.
- [A pushed frame arrives after the component unmounted] → `useWorkspaceEvents` unsubscribes on
  unmount; the animation-frame handle is cancelled in the effect cleanup, as V1's board does.
- [The `TRACKED` addition changes V1's observed live-update behaviour] → intended (it is the VS-328
  design); flagged in Decision 2 and the proposal so the reviewer can veto it at plan approval.
- [Enabling the frame could re-render often during a busy turn] → the daemon coalesces to at most one
  push per worker per 2s (`ACTIVITY_PUSH_MS`), and the client coalesces again per animation frame.
- [A live worker with no activity and no prior summary shows only a mark] → acceptable; the column and
  the mark already say it is moving, and the next tool call fills the line.

## Migration Plan

UI-only; no data, config or API migration. Rollback is reverting the change. The only cross-surface
effect is the `TRACKED` addition described in Decision 2, which is inert until a `worker.activity`
frame is broadcast.

## Open Questions

None that would change the specs, the approach or the task breakdown.
