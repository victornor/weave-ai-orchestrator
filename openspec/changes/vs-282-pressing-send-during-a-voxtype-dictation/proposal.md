# Pressing send during a Voxtype dictation stops it and sends once the transcript lands

Tracker change for [VS-282](conductor://tickets/VS-282). Filed by captain on 2026-09-12, on the
non-streaming dictation introduced in VS-179 / VS-186 and locked in VS-195.

## Why

On the non-streaming (upload / Voxtype) backend, `Composer.tsx` disables the send control for the
whole record-and-transcribe window (`locked = dictation.mode === 'upload' && (dictating ||
transcribing)`). Finishing a dictated message therefore costs three deliberate acts and a wait: stop
the mic, wait for the transcript, then send. captain wants the first and third collapsed into one:
pressing send while dictating should stop the dictation and send the moment the transcript lands.

## What Changes

- While the active backend is non-streaming and is recording or transcribing, the **send control is
  available** and means "finish and send":
  - pressed while recording, it stops the dictation and waits;
  - pressed while transcribing, or after it was just stopped this way, it waits;
  - the moment the transcript is in the composer, it submits, transcript included.
- The submit is triggered off the state the transcript lands in, never a snapshot of the composer
  text captured when the button was pressed — that is the defect that would silently send what was
  typed before the transcript.
- While a send is pending on a transcript, the composer says so plainly (button and status line);
  the pending send is idempotent, so repeated presses or using the mic's stop still produce exactly
  one message.
- An empty or failed transcript clears the pending send, leaves the composer usable with whatever
  text exists, and tells the human. Nothing empty is ever submitted.
- Everything else about the VS-195 lock is unchanged: the textarea and attach control stay locked
  while recording or transcribing, and the mic's stop control keeps its current availability.
- The streaming (Chrome / Web Speech) backend is untouched: its send already works, live, and must
  not be routed through a queue it does not need.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/composer-dictation-lock`: the lock no longer extends to sending; for the
  non-streaming backend, sending gains a "finish and send when the transcript lands" meaning, with
  its pending, empty/failed and one-message guarantees. The textarea/attach lock, both indicators,
  the "always returns to normal" guarantee, and the streaming-unaffected requirement are preserved.

## Impact

- `packages/ui/src/components/Composer.tsx` — send gating and the new pending-send handling.
- `packages/ui/src/test/dictation.test.tsx` — new tests for the finish-and-send paths; existing
  VS-195 tests for textarea/attach locking and the streaming path keep passing unmodified.
- No server, API, schema or `useDictation` interface change is expected; the hook already exposes the
  `mode` / `listening` / `transcribing` / `error` lifecycle this needs (VS-195).
