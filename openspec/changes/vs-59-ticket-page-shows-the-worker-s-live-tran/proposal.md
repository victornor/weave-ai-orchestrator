# The ticket page and the Run page show a turn's transcript as it happens

Tracker change for [VS-59](conductor://tickets/VS-59). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

VS-9 built the live view of a run — `GET /api/w/:ws/runs/:id/events/stream` on the daemon,
`useRunEventStream` on the client, `runEventsToTranscript` + `Transcript` as the renderer — but
wired it into exactly one surface: the conductor's own turn in `routes/Chat.tsx`.

Everywhere a *worker's* turn is shown, it is still a static row:

- `routes/TicketPage.tsx` `ActivityTab` renders a run as one line — `turn 2 · running · 8m` — with
  nothing under it. Watching an approved plan get implemented means watching that line's clock.
- `routes/RunPage.tsx` renders `<Transcript events={useRunEvents(runId)} />`, a one-shot query, so
  a run page opened mid-turn shows whatever had happened at load time and never moves again.

`conductor attach <agent>` already shows the same events live in the terminal, so nothing is missing
from the daemon. This is wiring, plus the two pieces the existing renderer does not have: a bounded
scroller that follows its own bottom, and a cap on how much of a long transcript is rendered.

## What changes

- **`useRunEventStream(runId, { live })`.** The one live-view hook grows an explicit `live` flag.
  `live: true` (the default, so `Chat.tsx` is untouched) replays and tails the SSE stream; `live:
  false` keeps the persisted `useRunEvents` query and opens no `EventSource`. A finished turn is
  therefore fetched, not streamed, through the same hook and the same merge — and a turn that
  finishes while it is being watched closes its stream and keeps what it already showed.
- **`useStickToBottom(signal, { follow })`.** The follow is what a live transcript wants and a
  finished one does not: an expanded finished turn must open at its first line, not its last.
  `follow: false` suppresses the scrolling; the upward-scroll pause, the button and the unread dot
  are unchanged.
- **`Transcript` caps its rendered window** at 150 blocks with a `Show earlier` control that reveals
  150 more. A four-hour turn is thousands of events; the cap is what keeps the page from degrading,
  and it applies to the chat's live region too.
- **`RunTranscript`** — new component — is the bounded scroller both surfaces mount: its own
  `ac-scroll` box, `useStickToBottom` gated on `live`, and the chat's `ScrollToBottomButton` floating
  over it. It scrolls itself rather than the page, so the ticket page's feed and the Run page's stat
  tiles stay where they are.
- **`ActivityTab` renders a run as `RunTurn`.** A running turn is expanded and streaming on arrival;
  when it finishes it collapses to its summary row, which carries a `show transcript` toggle. A
  finished turn fetches its events only once the human expands it, and nothing is requested while it
  is collapsed.
- **`RunRoute` follows a running turn** through the same hook and the same component, and stops
  following when the run reaches a terminal status. Resuming mid-turn needs no new code: the stream
  replays before it tails and reconnects with `?after=<seq>`.
- **`run.started` / `run.finished` invalidate `qk.ticketRuns`.** Both events already carry
  `ticketId` (`packages/core/src/runs/engine.ts:149,363`) but the client's invalidation map only
  touched `qk.runs` and `qk.run`, so the Activity tab learned about a new turn — or a finished one —
  only on a remount. Without this the collapse-on-finish never fires.

## Out of scope

Steering the worker from the ticket page; changing what the daemon records in run events;
`WorkerPage`'s transcript, which is a different list (it is the agent's turns, not one run).
