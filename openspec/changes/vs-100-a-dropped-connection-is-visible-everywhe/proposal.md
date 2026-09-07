## Why

The workspace event stream already surfaces its connection state through `ConnectionBanner`
(`packages/ui/src/components/ConnectionBanner.tsx`), driven by `EventStream`
(`packages/ui/src/api/events.ts`). The conductor chat's own live turn stream
(`useRunEventStream`, `packages/ui/src/api/runStream.ts`) and the onboarding job stream
(`useJobStream`, `packages/ui/src/api/jobStream.ts`) each reconnect on their own backoff but
report no state at all — on `onerror` they close, count an attempt and retry silently. On a
flaky mobile connection the live turn simply stops updating with nothing on screen, which is
what captain saw.

Two related gaps compound it in the chat specifically: sending a message calls
`post.mutate(...)` with no error handling, so a send that fails because the daemon is
unreachable (not because the device is offline) is silently dropped and leaves the "working"
indicator stuck forever (nothing ever calls `setSending(false)` for that path); and decision
cards answered inline in chat call `answer.mutate(...)` directly with no offline queueing at
all, unlike the equivalent flow in `NeedsYou.tsx`, which already queues a non-secret answer and
refuses a secret-carrying one.

## What Changes

- The run event stream and the job stream gain a connection state (`connecting`, `connected`,
  `reconnecting`, `offline`) built on the same state machine as the workspace event stream:
  bounded backoff that retries indefinitely, a distinction between the device being offline
  (`navigator.onLine`, the browser's `offline`/`online` events) and the server being
  unreachable, and an immediate reconnect on the browser's `online` event rather than waiting
  out the backoff.
- Both hooks expose that state and a manual "retry now" action to their callers, instead of a
  bare data return.
- The conductor chat renders the run stream's connection state where the streaming output is
  (inside the "Conductor is working" block), with a manual retry control, so a dropped stream is
  visible without relying on the app-level banner. The notice never overlaps the composer or the
  phone bottom bar.
- Sending a chat message or answering a decision card in chat that fails because the daemon
  cannot be reached is queued through the existing offline queue
  (`packages/ui/src/lib/queue.ts`) and delivered on reconnect, the same way NeedsYou already
  handles decisions — instead of being silently dropped. A secret-carrying decision card is still
  never queued.
- The onboarding job view (`Onboarding.tsx`) surfaces the job stream's connection state the same
  way, since a dropped connection there currently looks identical to a stalled job.

## Capabilities

### New Capabilities

- `live-streams/connection-state`: the client-side contract shared by any per-entity SSE stream
  (the run event stream, the job stream) — the connection states it can be in, that it retries
  indefinitely with bounded backoff, that it distinguishes the device being offline from the
  server being unreachable, that it reconnects immediately on the browser's `online` event, and
  that a manual retry is always available.

### Modified Capabilities

- `conductor-chat/live-turn-stream`: extends "A reload mid-turn resumes the live view" with the
  run stream's connection state being visible in the chat itself (not only the app-level
  banner), a manual retry, and the phone-layout constraint that the notice never covers the
  composer or bottom bar. Adds that a message send which cannot reach the daemon is queued or
  the human is told it was refused, never silently dropped.
- `human-decisions/answer-inputs`: extends the offline-queueing behavior already specified for a
  decision card's secret input to also require that a non-secret answer is queued while the
  surface presenting the card cannot reach the daemon, on every surface that presents a decision
  card — not only Needs You.
- `workspace-setup/setup-jobs`: the job stream a client attaches to for a running job surfaces
  the same connection state as `live-streams/connection-state`, so a surface watching a job (the
  onboarding job view) can tell a dropped connection from a job that has genuinely stalled.

## Impact

- `packages/ui/src/api/runStream.ts`, `packages/ui/src/api/jobStream.ts`: gain a shared
  connection-state implementation and a changed return shape.
- New `packages/ui/src/api/sseStream.ts` (or similar): the shared reconnecting-stream hook the
  two above are built on, replacing the duplicated backoff arrays and reconnect loops.
- `packages/ui/src/routes/Chat.tsx`: renders the run stream's connection state inline, fixes the
  silently-dropped send and decision-answer paths.
- `packages/ui/src/routes/RunPage.tsx`, `packages/ui/src/routes/TicketPage.tsx`: updated for the
  new `useRunEventStream` return shape (no behavior change required there).
- `packages/ui/src/routes/Onboarding.tsx`: updated for the new `useJobStream` return shape and
  renders its connection state.
- No daemon or API change: the `?after=` replay-then-tail contract on both streams is unchanged.
