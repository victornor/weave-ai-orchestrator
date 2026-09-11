## Context

`conductor attach` fetches `GET /workers/:id` once and picks fields out of it for its transcript and
status card. That payload already carries `input: { midTurn, reason? }` from
`describeLiveInput` (`packages/core/src/runs/active.ts:73`): the runtime must declare
`capabilities.streamingInput` and an active run for this agent must hold a `send` handle. The web app
renders that fact before typing (`WorkerPage.tsx:92`, `TicketPage.tsx:409`); the TUI has the payload
but not the field on its local `WorkerDetail` type (`Attach.tsx:21`) and shows a fixed placeholder
(`Attach.tsx:189`).

The attach screen already refetches `GET /workers/:id` whenever its `nonce` state changes. `nonce` is
bumped by the user's own actions (`act`, `submit`, the `R` key) and by two workspace-stream events:
`worker.status` and `run.finished` (`Attach.tsx:88`). The same stream handles `run.started`
(`Attach.tsx:81`), which swaps the current run and clears the transcript but does not bump `nonce`.

## Goals / Non-Goals

**Goals:**
- Make the attach input say, before the human types, whether a message reaches the running turn or
  queues — with the reason when the API supplies one — using the web app's wording.
- Define the unknown-yet state so it implies neither answer.
- Define the refresh behaviour explicitly, without a polling loop.
- Leave `deliveryNotice`, `describeLiveInput`, the web app and the adapters untouched.

**Non-Goals:**
- Changing how delivery happens, how `describeLiveInput` computes its answer, or the after-send
  notice.
- Adding a TUI component-test harness. `packages/tui` has no `ink-testing-library` dependency and no
  existing rendered-output test; the pure label function is tested as a function, matching the
  existing `deliveryNotice` test.

## Decisions

**Render the label as its own line, not as the placeholder.** The web app shows the same sentence
above the composer (`Composer.tsx`'s `queuedReason`), and a dedicated line is visible in *command*
mode too — the human learns which delivery their words will get before they even press `i` to type.
The placeholder then reverts to a neutral `steer the worker`; it never asserts a delivery either way.
The line is suppressed while no status is known, which is the "no label" unknown state the spec
asks for. The transcript's line budget (`maxLines`) is reduced by one whenever the line is shown so
the screen does not overflow.

**Compute the label in a pure, exported function.** `preSendLabel(input)` returns `null` for an
unknown/absent status, the web app's exact mid-turn sentence when `midTurn` is true, and its exact
queued sentence (with ` — <reason>` when a reason exists) otherwise. Exporting it matches the
existing `deliveryNotice` pattern and makes the wording assertable by a unit test without a renderer.
The wording is deliberately the same literals as `WorkerPage.tsx`/`TicketPage.tsx`, pinned by test —
the ticket asks for the web app's wording, not a refactor of the web app.

**Refresh from the events the screen already listens to.** A turn ending already refetches via
`run.finished`; a turn starting does not, so `run.started` for this agent additionally bumps `nonce`.
No interval, no new stream, no request on a timer — the label changes only when the daemon says the
agent changed. The `run.started` event is emitted at the start of `executeRun`
(`packages/core/src/runs/engine.ts:235`) while the runtime's `send` handle is attached slightly later
(`engine.ts:385`); the refetch can therefore land a moment before the handle exists and show `queued`
briefly. A subsequent `worker.status`/`run.finished` refetch corrects it. Accepting that one-refetch
window is the cost of not adding a poll or a new backend event, both of which the ticket rules out.

Alternative considered: make the placeholder itself conditional (`input.midTurn ? … : …`). Rejected
because it is only visible after entering insert mode, so the human learns the answer only after
committing to type, and because it conflicts with the unknown state — a placeholder always shows
something, so "no label before the status is known" has no honest value.

Alternative considered: add a dedicated daemon event when the send handle opens, so the label is
exact with no race. Rejected as a backend change beyond this ticket's stated scope (no adapter or
`describeLiveInput` work), for a one-refetch cosmetic window.

## Risks / Trade-offs

- [`run.started` refetch can briefly show `queued` on a mid-turn-capable runtime] → Documented above;
  self-corrects on the next status/refetch, and no poll is introduced. Verify during apply that a
  `worker.status` or `run.finished` refetch follows.
- [The label line could push a short terminal past its height] → `maxLines` is reduced by one while
  the line is present, keeping the transcript the only shrinking region.
- [Wording drifts from the web app] → The test asserts the exact literals the web app renders; a
  future change to one surface without the other fails the TUI test.
