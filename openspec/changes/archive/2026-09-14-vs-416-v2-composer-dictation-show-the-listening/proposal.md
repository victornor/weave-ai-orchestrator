# V2 composer dictation: listening inside the box, scrolled to the newest text, platform-correct hint

Tracker change for [VS-416](weave://tickets/VS-416). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Captain's 2026-09-14 report names three defects in the V2 chat composer
(`packages/ui/src/v2/ChatComposer.tsx`):

- **The listening state is a second box.** The meter / "Listening…" row renders *below* the composer
  (around lines 288–302), so starting dictation grows a new strip under the input instead of taking
  over the input itself.
- **Long dictation is not scrolled into view.** The transcript is appended to the controlled `value`,
  and the height effect (`useLayoutEffect`, lines 132–137) resizes the textarea but never moves
  `scrollTop`, so a long transcript is inserted with the box still showing its top.
- **The hint is always Mac.** Line 218 hardcodes `⌘⇧M to dictate`; the handler already accepts
  `metaKey || ctrlKey` + Shift + `KeyM`, so Windows and Linux users are told a chord they cannot
  press.

A fourth defect sits inside acceptance 1, reported by captain on 2026-09-14: sending while dictation
is still running submits before the transcript exists, so the daemon rejects the empty body
(`body is required`). `useDictation` gives Web Speech's final result and the daemon transcription
response no common "attempt ended" signal — `transcribing` is upload-only — so the composer cannot
know when the completed text is safe to send.

## What changes

- **The listening state replaces the textarea inside the same composer box** — the waveform (upload
  mode, when `metered`) or the pulsing "Listening…" line (speech mode), plus the `m:ss` elapsed time,
  in the flex-1 slot the textarea occupies; the microphone button becomes the stop affordance
  (square icon, `aria-label="Stop dictation"`). The separate row below the box is removed, so no
  second box appears above or below. Stopping, releasing the shortcut or pressing send returns the
  textarea with the dictated text in it.
- **Dictation scrolls the textarea to its end and puts the caret after the inserted text.** The
  layout effect treats an insert that came from dictation as "caret at end": it scrolls to
  `scrollHeight` and sets the selection range to the end of the value. Regular typing in the middle
  still leaves the caret and scroll position alone.
- **The hint is platform- and input-aware.** A pure helper renders `hold ⌘⇧M to dictate` on macOS,
  `hold Ctrl+Shift+M to dictate` on Windows/Linux (push-to-talk, so the hint says hold), and keeps
  `tap the mic to dictate` on touch.
- **Send while dictating sends the completed text.** Send (the button, since the textarea is
  replaced while listening) queues the submit and stops the dictation; the queued submit waits for
  the attempt to settle — the recognizer's final result on the Web Speech path, the transcription
  response on the daemon path — and then submits the current value, so the last words are included
  and an empty body is never sent mid-dictation. The hook exposes the new `settled` signal this
  needs; `transcribing` alone is upload-only and cannot cover Web Speech.
- **Tests** in `packages/ui/src/test/v2chatcomposer.test.tsx` cover the listening state living inside
  `[data-testid="v2-composer"]` with no sibling row, the scroll-and-caret behaviour, the platform
  hint for meta and ctrl, and the queued send for both providers (including the empty-transcript
  case). `packages/ui/src/test/dictation.test.tsx` covers `settled` on both paths.

## Out of scope

The Plan button (VS-398), the transcription provider, V1's composer, and any other composer feature.
The microphone button, the unavailable-provider notice and error messages are unchanged.
