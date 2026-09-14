# Fix the keyboard dictation stop and show a transcribing state

Tracker change for [VS-441](weave://tickets/VS-441). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14, on release 9c7a9ed557 (which includes VS-432):

- **A. The keyboard stop fails.** Starting a dictation with Ctrl+Shift+Space and stopping it with
  the same chord shows **"Transcription failed"**, while stopping with the mic (stop) button or the
  send button works every time. Upload (Voxtype) mode.
- **B. Nothing shows while transcribing.** After a stop the listening animation disappears and the
  input sits **empty for a few seconds** until the transcript lands. The box should show a smooth
  "transcribing" animation in the same family as the listening meter.

The daemon journal has 7 `voxtype transcribe input audio` records in the window with **no warning or
error line**, and two of them are wrong: a `0.43s` near-silent clip and a `311.4s` clip. Those point
at the client state machine (a duplicated/aborted stop, or a session whose stop was lost), not at a
daemon error.

## What changes

### A. The keyboard stop behaves exactly like the stop button

- The shared chord (`packages/ui/src/lib/dictationHotkey.ts`) **swallows the chord on keyup as well
  as keydown**, so a focused mic/stop/send button is never activated by the Space keyup of a
  toggle-off. It also **ends a push-to-talk hold whose keyup never arrived** (window blur/focus
  loss) instead of leaving the hook holding a stale `pressed` phase while the mic stays open — the
  5-minute recording.
- `packages/ui/src/lib/dictation.ts` gains a **session guard** so a stop with no live session is a
  no-op (a second stop cannot clear `settled` early or post again), and treats an **aborted request
  as a non-event** rather than "Transcription failed".
- An empty or too-short recording (the `0.43s` clip) is reported as "nothing was recognized", not as
  a failure.
- One chord toggle-off produces exactly **one stop and one upload**; no second stop and no start
  while a transcription is in flight; hold-to-talk is unchanged.

### B. A smooth transcribing state

- A shared `TranscribingIndicator` in the same visual family/accent as `VoiceMeter`: the meter's
  bars settling into a gentle travelling pulse, with a quiet "Transcribing…" label.
- `packages/ui/src/v2/ChatComposer.tsx` renders it in the input area while
  `dictation.transcribing`, so the box **never flashes empty** between listening and the transcript
  landing; it is reached through the Plan modal too, since that uses ChatComposer.
- V1's `packages/ui/src/components/Composer.tsx` uses the same indicator instead of only its border
  and spinner row.
- Reduced motion shows a static indicator with the label; `aria-live="polite"` announces
  "Transcribing".

## Out of scope

- The auto-send setting (VS-435).
- The ≤5-word discard rule (VS-439).
- The dictation reveal animation itself (VS-425).