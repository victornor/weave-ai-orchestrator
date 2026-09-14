# V2 live trace panes: readable, following, resizable

Tracker change for [VS-409](weave://tickets/VS-409). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

One shared component, `packages/ui/src/v2/WorkerFeed.tsx`, renders every expandable live trace in
V2: the **Watch** toggle on a held decision card, the per-worker pane on **Roles**, and the worker
page's transcript. Its compact variant is 132px tall, opens at the top of the trace, and (on the
phone) overflows its own box so the last line cannot be reached. Its chrome carries a **Refresh**
button that reconnects nothing while the stream is live. No pane is resizable, and Roles can only
expand a worker that is currently running — a paused or between-turns worker with a ticket cannot
be opened at all.

## What changes

- **A bounded box that matches its scroller.** `RunTranscript` gains a `maxHeight` prop so the
  caller's box and the transcript's own scroll element share one height; `WorkerFeed`'s body is
  always `overflow-hidden`. The scroll range then reaches the true end of the content (VS-409 #3).
- **Watch opens at double height.** The compact pane's height becomes 264px (was 132), so the
  Needs-you card and the chat decision pane open at a readable size (VS-409 #1).
- **Follow the newest line.** The pane opens at its newest output and follows as it arrives; a
  human scrolling up pauses the follow until they return to the bottom (VS-409 #2).
- **No live Refresh.** The always-on `Refresh` is removed. A `Reconnect` control appears only once
  the run stream has dropped (VS-409 #4).
- **Roles expands any worker with a ticket.** A worker that is not running but has a ticket opens
  its newest run's trace in place; a worker with no ticket still opens its page (VS-409 #5).
- **A corner resize grip** on every expandable pane (Roles, Watch): pointer drag, up/down arrows,
  double-click reset, clamped between a readable minimum and most of the viewport (VS-409 #6).

## Out of scope

The V2 Live floor's shared tile-height drag (VS-372) is unchanged; Live passes an explicit
`bodyHeight` and no grip. Chat message-trace collapsing (VS-370) is untouched.
