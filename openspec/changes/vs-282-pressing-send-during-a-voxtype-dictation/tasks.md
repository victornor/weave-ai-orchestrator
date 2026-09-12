## 1. Composer: send means "finish and send" on the non-streaming path

- [x] 1.1 Extract the guarded send body of `send()` into a `doSend(text: string)` callback in `packages/ui/src/components/Composer.tsx`, carrying the existing idempotency key (`lastFailed` reuse), `inFlightLabel`, `submittingRef`/`submitting`, success clearing and failure retention unchanged. Verify: the existing send tests (`composer-send-lifecycle`, the speech-mode send tests) pass unmodified.
- [x] 1.2 In `send()`, before the empty-text check, add the non-streaming finish-and-send branch: when `dictation.mode === 'upload'` and (`dictation.listening` or `dictation.transcribing`), set the pending-send ref and state, call `dictation.stop()` if recording, and return; make a second call while already pending a no-op. Everything else in `send()` keeps today's path (including stopping a speech mic). Verify: pressing send while recording stops the recording and starts transcribing; pressing send while transcribing starts no second recording.
- [x] 1.3 Add a settle effect (deps: pending state, `dictation.transcribing`, `dictation.error`, `text`, `doSend`) that, when pending and `transcribing` is false, clears the pending send and then either submits `text.trim()` via `doSend` when there is text and no error, or submits nothing. Verify: a landed transcript submits; an empty or failed transcript submits nothing and leaves the composer usable.
- [x] 1.4 Add a composer-owned notice for the zero-length-capture case (attempt settles with no hook error and nothing to send), so the human is told even then; do not add a second notice when the hook's error alert already covers it.
- [x] 1.5 Send control gating in `Composer.tsx`: remove the upload lock from its `disabled`; allow an empty composer to trigger the finish-and-send branch while upload dictation is active; keep it disabled while pending or submitting. Leave the textarea and attach control on the VS-195 `locked` disable.
- [x] 1.6 Pending indication: while a send is pending, give the send control a distinct queued state and accessible label, and render a `role="status"` line stating the message will send when the transcript lands.
- [x] 1.7 Reword the upload-mode listening caption so its "composer stays locked" clause no longer contradicts sending being available, keeping the capture-now/transcribed-on-stop statement and its unbreakpointed (always-visible) classes.

## 2. Tests (`packages/ui/src/test/dictation.test.tsx`)

- [x] 2.1 Sending while recording stops the recording and submits once with the transcript after it lands (acceptance 1); assert the textarea and attach control are still disabled during recording while send is available.
- [x] 2.2 Sending while already transcribing submits once when the transcript lands and starts no second recording (acceptance 2).
- [x] 2.3 A transcript that differs from the composer's text at press time is what gets submitted — type text, then dictate a different phrase, then send; assert the submitted message contains the transcript (acceptance 3).
- [x] 2.4 A failed transcription clears the pending send, submits nothing, leaves the composer usable and shows the failure (acceptance 4).
- [x] 2.5 An empty transcript clears the pending send, submits nothing, leaves the composer usable and tells the human (acceptance 4).
- [x] 2.6 Pressing send repeatedly, and using the mic's stop after send, each submit exactly one message (acceptance 5).
- [x] 2.7 While a send is pending, the composer shows a queued indication for it (acceptance 6).
- [x] 2.8 Streaming (speech-mode) send stays immediate and unqueued: it does not wait for a transcript and shows no pending state (acceptance 7).
- [x] 2.9 Update only the now-obsolete VS-195 assertion that send is disabled during recording; the textarea/attach lock assertions and the speech-mode assertions stay as they are.

## 3. Verification and delivery

- [x] 3.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` all green from `work/`; paste both suite blocks (core/server and UI) verbatim into the report, never summed and never one presented as both.
