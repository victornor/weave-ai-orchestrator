## Why

`GET /workers/:id` already reports `input: describeLiveInput(...)` — whether the human's next message reaches the running turn or queues for the next one, and the runtime's reason when it queues. The web app renders that before typing (`WorkerPage.tsx:92`, `TicketPage.tsx:409`). `conductor attach`, the surface a human reaches for to work *with* a worker, fetches the same payload and ignores the field: its placeholder is a fixed string and the only signal is the after-send `deliveryNotice`. On four of five runtimes a typed message waits for the next turn (median 58s on claude, 208s on cursor, 305s on opencode), so an unlabelled three-to-five-minute wait reads as being ignored. The backend is already correct for every runtime; only the attach view is silent.

## What Changes

- `packages/tui/src/apps/Attach.tsx` reads `input` from the detail payload it already fetches (its local `WorkerDetail` type does not declare it today).
- A pre-send status line is shown above the input, in command and insert mode alike, saying whether the message reaches the running turn or queues — carrying the reason when the API supplies one. The wording is the web app's, not a third variant.
- Before the first detail fetch resolves, no status line is shown, so the view implies neither answer. The line is not a polling loop: it refreshes from the `nonce` refetch the screen already performs on `worker.status` and `run.finished`, extended to `run.started` for this agent so the line also updates when a turn begins.
- The placeholder reverts to a neutral `steer the worker`; the after-send `deliveryNotice` is unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-attach/live-input`: adds a requirement that the attach surface's input label states which delivery will happen before the human types, with the reason when one is supplied, the same wording as other surfaces, no implication before the status is known, and no polling added for it.

## Impact

- `packages/tui/src/apps/Attach.tsx` (declare `input`, compute and render the label, refresh on `run.started`)
- `packages/tui/src/apps/Attach.test.ts` (pure label unit tests, alongside the existing `deliveryNotice` tests)
- No API, adapter, web-app, or `describeLiveInput`/`deliveryNotice` behaviour change.
