# Non-streaming dictation must show it is listening and lock the composer

Tracker change for [VS-195](conductor://tickets/VS-195). Filed by captain on 2026-09-10, on the
dictation added in VS-179 / VS-186.

## Why

`useDictation` (`packages/ui/src/lib/dictation.ts`) already distinguishes `mode: 'speech'` (Chrome
Web Speech, streaming) from `mode: 'upload'` (Voxtype on the daemon, non-streaming), but
`Composer.tsx` treats both the same: the textarea stays editable throughout, and the only feedback
while recording is the meter row shown while `dictation.listening` is true. On Chrome that is fine —
words appear as they are spoken. On Voxtype nothing appears until the human stops, and captain's own
log shows a further ~2.5s gap after that before the transcript lands. The composer looks dead for the
whole utterance plus a couple of seconds, and there is no signal at all for the post-stop gap: today
`stop()` clears `listening` immediately and the request happens silently in the background.

## What Changes

- `useDictation` gains a `transcribing` flag: true from the moment recording stops on the upload
  path until the daemon's response (success, empty text, or error) has been handled. Always `false`
  on the speech path — Chrome never has a transcribing phase.
- While `mode === 'upload'` and the hook is `listening` or `transcribing`, the composer **disables**
  the textarea, the attach control and the send control (see `design.md` for why disable rather than
  hide). The mic control stays live so it remains the one way to stop recording; it is disabled only
  during `transcribing`, when there is nothing left to stop.
- The listening indicator for upload mode states plainly that speech is being captured now and will
  be transcribed once recording stops, alongside the existing meter and elapsed timer.
- A new, visually distinct transcribing indicator (spinner + label) replaces the listening indicator
  once recording stops, until the request settles.
- The composer returns to its normal editable state on every outcome — inserted text, an empty
  transcript, or a failed request — never left locked.
- The Chrome / speech path is unchanged: no lock, no transcribing indicator, existing behaviour and
  tests untouched.

## Capabilities

### New Capabilities

- `conductor-chat/composer-dictation-lock`: the composer's locked/listening/transcribing states while
  a non-streaming dictation backend is active, and that the streaming backend is unaffected.

### Modified Capabilities

(none — `web-dictation/host-backend` governs backend selection and transcription itself, not the
composer's own state machine while it waits)

## Out of scope

- The transcription backend, the daemon's Voxtype integration, or the model (scope line in the
  ticket).
- Surfacing an empty-transcript outcome to the human as a distinct message — the companion ticket on
  degenerate transcription owns that; this change only guarantees the composer is not left locked
  when it happens.
