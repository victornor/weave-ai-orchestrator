# Discard a dictation of five words or fewer

Tracker change for [VS-439](weave://tickets/VS-439). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: when a dictation session ends and the result is **five words or fewer**, don't
put it in the message box. Leave the field as it was: empty if it was empty. A stray "yes", a cough,
or a half-heard aside is far more likely than a deliberate short message, and clearing the box by
hand afterwards is worse than saying the whole thing again.

VS-435 (auto-send when dictation ends) changes the same composer stop and send code, so this builds
on it.

## What changes

- **One shared rule** in `packages/ui/src/lib/dictation.ts`: `DICTATION_MIN_WORDS = 6` and
  `isDictationTooShort()`, used by both composers so V1 and V2 cannot drift. Words are
  whitespace-separated tokens that contain at least one letter or digit; punctuation-only tokens
  don't count.
- **Both composers** (`components/Composer.tsx` V1, `v2/ChatComposer.tsx` V2): when the session
  ends with a short transcript, restore the draft to exactly what it was before the mic opened
  (removing the interim words shown while talking), don't start the VS-425 reveal, and clear a
  queued (VS-282) or auto-armed (VS-435) send instead of submitting the old draft.
- **Applied at session end** (`settled`), not on every `final` result: Android marks mid-sentence
  restatements final (VS-70), so filtering each final result would wipe the box while the human is
  still talking. Interim words still appear live; only the outcome is discarded.
- **Tests, V1 and V2, speech and upload**: five words discarded with the draft restored (including
  interim text); six words inserted; punctuation-only tokens not counted; prior typed text
  preserved on discard; a discarded result with a queued send or auto-send submits nothing and
  clears the queued state; the reveal isn't started; a failed transcription shows its own error,
  not the too-short notice.

## Out of scope

- The shortcut (VS-432), the auto-send setting itself (VS-435), the voice meter (VS-431).