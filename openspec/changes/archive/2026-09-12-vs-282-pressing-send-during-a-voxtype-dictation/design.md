## Context

- See `proposal.md` — Why. On the non-streaming (`upload` / Voxtype) path, `Composer.tsx` derives
  `locked = dictation.mode === 'upload' && (dictating || transcribing)` and disables the textarea,
  the attach control and the send control with it. `useDictation` (`dictation.ts`) already exposes
  everything a finish-and-send needs: `mode`, `listening`, `transcribing`, `error`, and an `onText`
  callback that writes the transcript into the composer through `set(...)`.
- `onText` for upload mode is called exactly once, from `postWav`'s success branch, before
  `transcribing` is cleared in the same promise chain's `.finally`. `transcribing` becoming `false`
  is therefore the one signal that the attempt has settled (VS-195), and `error` distinguishes
  "landed" from "empty or failed".
- `send()` today guards `if (!t || ...) return;` — an empty composer cannot send. That guard has to
  be relaxed only for the finish-and-send press, and only for the upload path.

## Goals / Non-Goals

**Goals:**

- One press of send during a non-streaming dictation ends the dictation and sends the transcript,
  built from composer state at the moment the transcript lands.
- The press is legible and idempotent: shown as queued, and never more than one message.
- An empty or failed transcript cannot submit anything or leave a stuck state.
- The streaming path's send is byte-for-byte unchanged, and so is the VS-195 textarea/attach lock.

**Non-Goals:**

- No change to `useDictation`, the transcript pipeline, `mergeTranscript`, the meter, or the
  indicators themselves.
- No change to what a normal (non-dictation) send does, including the send-lifecycle idempotency key
  and failure retention.
- No change to the streaming backend's send path or to the textarea/attach lock.

## Decisions

### Settle off composer state, not a value captured at press

The pending send is a `pendingSend` state set the moment send is pressed. A React effect keyed on
`pendingSend`, `dictation.transcribing`, `dictation.error` and `text` performs the submit when the
attempt settles, reading `text` from that render. A captured closure — passing the pre-press `text`
into a callback that runs later — is the exact defect the ticket calls out, and is rejected.

Alternative: add an `onSettled`/`onTranscript` callback to `useDictation`. Rejected — the hook
already tells the composer the attempt settled (`transcribing === false`) and how it ended (`error`),
and the submit belongs to the composer. Adding an interface would touch the VS-195 hook and its
tests for no gain.

### One submit path, extracted

The body of `send()` after the guards becomes `doSend(text)`, and both the normal send and the
settle effect call it. This keeps the idempotency key, the `inFlightLabel`, the `submitting` lock and
the failure-retention behaviour in exactly one place, so the queued send cannot drift from a normal
one. Alternative: have the effect call `send()` — rejected: `send()` re-reads dictation state and the
pending guard, making the effect re-entrant and hard to reason about.

### A ref guards the queue, state drives the UI

`pendingSend` is backed by a ref set synchronously in `send()`. React state alone would let two
presses in the same tick both pass the guard before a re-render; the ref makes the second a no-op.
The state is what shows the pending UI. This is the same state+ref pairing the hook uses for
`transcribing`.

### Empty or failed: clear, do not submit, let the existing error tell

When the attempt settles with `error` set, or with an empty composer, the effect clears the pending
send and does not submit; the hook's existing `role="alert"` (`Nothing was recognized…`,
`Transcription failed on the daemon…`) is the "told the human" path, and the composer's text and
attachments are left as they were. A composer-owned notice covers the one case the hook does not
announce — a zero-length capture, where `postWav` returns before setting an error. Always adding a
second notice was rejected as a duplicate alert.

### Pending is shown, not a dead button

While pending, the send control is disabled (so a repeat press is a no-op, reinforcing the ref guard)
but rendered in a distinct queued state with its own accessible label, and a `role="status"` line
says the message sends as soon as the transcript lands. This satisfies "not a dead button, and not a
normal send that appears to have done nothing"; the later `submitting` progress is unchanged.

### Scope the new path to `mode === 'upload'`

`send()` branches on `dictation.mode === 'upload' && (listening || transcribing)`. Anything else —
including speech-mode dictation and the plain no-dictation send — takes today's path exactly,
including stopping a speech mic before sending. A streaming send therefore never queues.

### The listening caption stops claiming the whole composer is locked

The upload-mode caption currently ends "the composer stays locked until then", which is no longer
true for send. It is reworded to keep the VS-195 two-halves statement (capturing now, transcribed on
stop) and to point at send as the way to finish, without touching its always-visible (unbreakpointed)
treatment.

## Risks / Trade-offs

- **Stale text reintroduced by a future refactor** → the effect depends on `text`; a test asserts the
  submitted message contains a transcript that differs from the pre-press text.
- **Double submission** → ref guard plus disabling the control while pending; a test presses send
  repeatedly and uses the mic's stop after send, asserting exactly one submit.
- **A stuck pending send if the hook ever leaves `transcribing` true** → the hook's single `.finally`
  is the contract (VS-195); the composer cannot repair a hook bug, but failure, empty and network
  branches are each tested to clear the pending send.
- **Enabling send conflicts with `conductor-chat/composer-send-lifecycle`** → that capability governs
  a send already in flight; the pending send is disabled exactly as it requires, and `doSend` reuses
  the same in-flight lock and idempotency key.

## Non-Goals

As above: no hook, pipeline, lock, meter, indicator or streaming change.
