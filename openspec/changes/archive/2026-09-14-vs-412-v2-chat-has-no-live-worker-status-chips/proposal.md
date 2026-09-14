# V2 chat carries V1's live ticket and worker chips

Tracker change for [VS-412](weave://tickets/VS-412). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

V1 chat shows, in the conversation itself, what each weaver turn left behind. Under a reply's trace
it renders one dispatch chip per ticket that turn created, assigned or acted on
(`packages/ui/src/routes/Chat.tsx` → `DispatchLabel`), e.g. `VS-409 · Platform Engineer #379 ·
working`; at the bottom of the conversation it renders a row of live workers no message accounts
for (`WorkerChip`), e.g. `Platform Engineer #368`. Both read their data from the shared
`chatEntries`/`chatRows` view model (`packages/ui/src/lib/dispatch.ts`).

V2 chat (`packages/ui/src/v2/ChatPage.tsx`) reuses that view model but drops both halves: it calls
`chatEntries(...)` for `.entries` alone, never renders `entry.dispatches`, and discards the
`unattributed` list it returns. So a human reading V2 cannot see which ticket a turn filed or which
workers are live without leaving the conversation.

## What changes

- **A new V2 chip module, `packages/ui/src/v2/ChatChips.tsx`.** `V2DispatchChip` renders one
  dispatch — `StatusGlyph` (x-small, pulsing while `working`), the ticket identifier, the worker's
  name (or the ticket title before a worker exists) and the state label — and `V2WorkerChip` renders
  one live worker — `StatusGlyph` and name. Both use the one `.v2-tag` recipe (HANDOFF §3), take
  their state hue from `STATUS_TEXT[status]`, are real buttons, and route on click exactly where V1
  routes: a worker chip to the worker page, a dispatch chip to its worker page when it has one and
  to its ticket otherwise.
- **V2 chat renders them.** In `ChatPage.tsx`, each message row gains its `entry.dispatches` chips
  below `ChatTurnTrace`, in the view model's existing order; the `unattributed` live workers render
  as a `flex-wrap` row below the working/live block, where V1 puts them. The chips wrap cleanly at
  phone width and carry the V2 tag styling in both themes.
- **The screen fetches what the chips need.** `useTickets` gains `includeTerminal: true,
  fields: 'label'` and `useWorkers` gains `includeRetired: true`, matching V1's Chat, so a finished
  ticket's chip survives and a finished worker still resolves for its dispatch label.
- **A regression test** in `packages/ui/src/test/v2chat.test.tsx` holds an outbound message whose
  turn filed two tickets (one working with a worker, one done without) and a live worker with no
  message: it asserts the chips' content and order, the live worker row, both click targets, and
  that a worker status change re-renders the chip in place (no reload).

## Out of scope

- Any change to V1, its `DispatchLabel`/`WorkerChip`, or `lib/dispatch.ts` (the view model already
  returns everything needed). The Work board, the Live screen, the Watch preview and the Plan button
  are untouched.
- A daemon, route, schema or API change: the data is already fetched for V1.

## Impact

`packages/ui/src/v2/ChatPage.tsx`, a new `packages/ui/src/v2/ChatChips.tsx`, and the V2 chat test.
V1 at `/`, the daemon and the HTTP surface are unchanged.
