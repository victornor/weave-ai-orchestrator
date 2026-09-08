## Investigation

The ticket asked to establish why the card did not disappear on its own before designing a fix.
Traced the whole path end to end against the current code:

- **Server**: `supersedeOpen()` (`packages/core/src/decisions/service.ts:76-85`) marks the old row
  `superseded`, records activity, and emits `decision.superseded` through `EventBus.emit`
  (`packages/core/src/events.ts:10-17`) — a durable outbox write followed by an in-process
  `EventEmitter` broadcast.
- **Transport**: `GET /api/w/:ws/events` (`packages/server/src/routes/events.ts`) replays the outbox
  from `after`/`Last-Event-ID` and then tails the bus, subscribing *before* replaying so nothing
  emitted in that window is lost (`cursor`/`pump.drain()` dedupe by `seq`).
- **Client transport**: `EventStream` (`packages/ui/src/api/events.ts`) opens an `EventSource`,
  attaches named listeners for every tracked type including `decision.superseded`, and on each frame
  calls `invalidateFor`, which invalidates `qk.decisions(ws)`, `qk.decision(ws, id)`, `qk.briefing(ws)`
  and `qk.workspaces()`.
- **Client data**: both the chat's pinned area (`Chat.tsx`'s `pinned`, filtered `d.status === 'open'`)
  and Needs you (`NeedsYou.tsx`'s `items`, server-filtered to `status: 'open'`) derive directly from
  the same `useDecisions` query `invalidateFor` invalidates. `hiddenDecisions.ts` never resurrects a
  card and needs no trigger of its own — supersession changes the id, which was never hidden.
  `decisions.answer()` keys strictly off the id in the URL and refuses (`wrong_status`) unless that
  exact row is `open`, so a stale approve cannot land on the row that replaced it.

Every layer here is wired correctly for the steady-state case: server emits, transport carries,
client invalidates the right keys, and every list reads from what got invalidated. Nothing here is
broken in a way a unit test would have caught it broken.

What none of it does: **detect a connection that goes silent without the browser raising `error`**.
`EventStream` only changes state on `es.onerror`/`es.onopen`/the `online`/`offline` window events. A
connection that stalls — a mobile network handoff, a proxy that drops the socket without an RST, a
laptop resuming from sleep — can sit reporting `connected` indefinitely while delivering nothing, and
nothing today notices or recovers from that except some unrelated event later giving the browser a
reason to notice the socket is dead. The server sends a heartbeat every 15s (`sse.ts`), but it is a
comment frame (`: ping`), which `EventSource` never surfaces to `onmessage` or a named listener by
design — so the client has no signal to build a watchdog on today, and consequently no way to notice
this kind of drop on its own.

This is the most likely explanation for the report — a plan revised "seconds" before the click is
easily enough time for a routine reconnect to have happened, and the mechanism above would leave no
trace to confirm it after the fact. Per the team's own convention, this is not something to nail down
further by reasoning about one report from a single device; the fix below closes the gap regardless of
cause, the same way criterion 4 asks for, rather than betting the whole change on one guessed root
cause. It also happens to be a real, independently-motivated hardening: even a client that noticed the
drop immediately still has a network-round-trip window between "server changed the row" and "client
re-rendered", and closing that is straightforward.

## Goals / Non-Goals

**Goals:**
- Remove the round-trip window between a decision leaving `open` and the client's view reflecting it.
- Make the decisions list self-correcting after any connection drop, independent of whether the drop
  was ever detected as an error.
- Turn a stale-answer refusal into a message that tells the human what happened and, when there is
  one, where the replacement is.
- Lock in with a test that a stale answer can never be recorded against the wrong decision.

**Non-Goals:**
- A general liveness watchdog for the SSE transport (heartbeat-as-named-event, timeout-based forced
  reconnect). The reconnect-triggers-refetch approach below closes the observable gap without needing
  the transport to self-diagnose a stall; a transport-level watchdog is a larger, separately-scoped
  change if the gap ever needs closing faster than "the next thing that reconnects it".
- Changing when or how a decision is superseded (VS-104 settled that) or the card's layout.

## Decisions

**1. Patch cached decision-list queries directly from the event payload, in addition to invalidating.**
`decision.superseded` / `decision.answered` / `decision.expired` already carry the full updated
`Decision` row as their event payload. `invalidateFor` (`packages/ui/src/api/events.ts`) applies that
row to every cached `qk.decisions(ws)` query synchronously via `queryClient.setQueriesData`, before
the existing `invalidateQueries` call kicks off its refetch: for a query whose own `status` filter
still matches the new status, the entry is replaced in place (this is how an `answered` decision stays
in Chat's `['open','answered']` query as the record of the conversation); for one whose filter no
longer matches (Needs You's `status: 'open'` after the decision leaves `open`), the entry is removed
from the cached array. This closes the round-trip window entirely for the case that matters here: the
data needed is already sitting in the event, no request required. Invalidation is kept as a backstop
for other consumers.

Alternative considered: rely solely on `invalidateQueries` + refetch, as today. Rejected — it's the
window that let the card in the report stay visible even in a scenario where the event *did* arrive.

**2. On live-connection recovery, refetch the decisions list unconditionally.**
`EventStream` tracks whether it has ever completed an `onopen` before; on every `onopen` after the
first, it invalidates `qk.decisions(ws)` regardless of what caused the reconnect or whether the client
noticed a drop at all — this is what also repairs the case the investigation could not fully rule out
(a stall the client never saw as an error). The first connection of a session is excluded because
`useDecisions`'s own mount-time fetch already covers it; forcing a second fetch there would just be a
redundant request.

Alternative considered: give `EventStream` its own stall watchdog (expect a frame at least every N
seconds, force-reconnect otherwise). This would close the gap faster and is worth doing, but it is a
bigger change to a class three other call sites depend on and needs its own testing story
(fake timers, the heartbeat-as-comment-frame limitation described above). Left as a non-goal; the
reconnect-refetch here is the minimal fix that satisfies criterion 4 without it.

**3. `wrong_status` on a decision answer carries structured detail.**
`decisions.answer()` (`packages/core/src/decisions/service.ts:336-338`) already throws `wrong_status`
when `d.status !== 'open'`. Its `details` becomes `{ status: d.status, supersededBy?: string }`, where
`supersededBy` is filled by looking up the current open decision sharing the stale decision's
`correlationKey` and `ticketId` (at most one can exist, since `create()` always supersedes any open
decision under the same key before inserting a new one) — populated only when `status === 'superseded'`
and such a row exists. `OcError.details` already flows to the client unchanged as `ApiError.details`.

**4. The client turns that refusal into a specific message with a way to the replacement.**
Chat's and Needs You's answer-error handling switches on `ApiError.code === 'wrong_status'` and
`details.status` to choose the toast copy ("This plan changed while you were looking at it" for
`superseded`, "Already answered" / "This expired" for the other two) instead of showing the raw
message. When `details.supersededBy` is present, the toast carries an action that navigates to
`/w/$ws/tickets/$ticketId` (the ticket page already resolves and shows a ticket's current open
`plan_approval`/`merge_approval` by ticket id and kind, so no new lookup is needed there) rather than
trying to scroll a specific card into view in two different layouts.

**5. `Toast` gains a generic labelled action, generalising the unused `href` field.**
`Toast.href` is declared but never rendered. Rather than wire that specific shape, add
`action: { label: string; run: () => void }` next to the existing `undo`, rendered the same way
(a single button that runs and dismisses). `undo` keeps its own name and current call site
(`Settings.tsx`) unchanged — a separate field reads correctly at both call sites instead of overloading
"undo" to mean "navigate".

## Risks / Trade-offs

- [The reconnect-refetch is coarse — one refetch of the whole decisions list per reconnect, not just
  the entity that changed] → acceptable: reconnects are rare relative to normal operation, and the
  list this refetches is already capped (`limit`) and cheap.
- [A transport stall that never triggers any subsequent reconnect (network never recovers, tab never
  regains focus) still leaves a stale view until *something* reconnects it] → out of scope per Non-Goals;
  flagged for a follow-up if it recurs after this ships.
- [`supersededBy` lookup adds one query to every stale-answer refusal] → negligible; refusals are rare
  and the query is a single indexed lookup already shaped like `supersedeOpen`'s own.

## Migration Plan

No data migration. Deploys as a normal PR; both the cache-patch and reconnect-refetch are additive
client behavior, and the server's `details` addition is backward compatible (existing clients ignore
unknown detail fields).
