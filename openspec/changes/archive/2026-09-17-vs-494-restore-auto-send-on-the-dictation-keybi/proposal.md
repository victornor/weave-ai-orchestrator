# Restore auto-send on the dictation keybinding, keep Stop as the keep-the-text path

Tracker change for [VS-494](weave://tickets/VS-494). A `change` ticket.

## Why

VS-489 was asked to stop the **Stop button** from auto-sending. It went further and retired the
auto-send setting entirely — `dictationAutoSend.ts`, its Settings switch and its tests — reasoning
that no path could still trigger it. That reasoning was wrong: the dictation **keybinding** is
exactly the path the setting exists for. Captain, 2026-09-17: starting dictation with the chord and
ending it with the chord — a second press toggling it off, or releasing a held chord — must send
automatically when the setting is on. The Stop control must not. This restores the setting and
splits the two endings again, without undoing what VS-489 got right (Escape discards, dictation
follows the focused pane in the multi-chat view).

## What Changes

- **Restore the per-browser setting**: `packages/ui/src/lib/dictationAutoSend.ts`, its Settings →
  Dictation switch and `dictationAutoSend.test.ts`, with the same `conductor.dictationAutoSend`
  localStorage key and the same read/write semantics as before VS-489, so a human who had it on
  keeps it on. The switch copy is corrected to describe the keybinding-only behaviour.
- **Split the ending paths** in `dictationController.ts` and V1's `Composer.tsx`: the Stop control
  (in-composer mic, off-page bar) ends the session and leaves the transcript; the keybinding
  (toggle-off, held release, and the window-blur fallback for a lost release) arms the existing
  queued send when the setting is on.
- **Wire V2's shared session** so `DictationSessionProvider` gives the hotkey the keybinding ending
  and the bar keeps the never-send Stop.
- **Tests** assert submitted, not merely that a handler fired: both chord shapes send with the
  setting on; the mic and the off-page bar's Stop submit nothing with the setting on; the setting
  off leaves the transcript; Escape and the focused-pane behaviour are unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/chat-composer`: the requirement covering how a dictation ends is replaced — the Stop
  control never sends, and the dictation keybinding submits through the queued send path when the
  "Send automatically when dictation ends" setting is on.

## Impact

- `packages/ui/src/lib/dictationAutoSend.ts` — restored (VS-489 deleted it).
- `packages/ui/src/lib/dictationController.ts` — a keybinding-ending path distinct from `stop()`.
- `packages/ui/src/v2/DictationSession.tsx` — the shared hotkey uses the keybinding ending; the
  bar's Stop keeps the never-send ending.
- `packages/ui/src/components/Composer.tsx` — V1's mic stops without sending; its hotkey uses the
  keybinding ending.
- `packages/ui/src/settings/sections.tsx` — the Dictation switch restored.
- Tests: `dictationAutoSend.test.ts` (restored), `dictation.test.tsx`,
  `v2chatcomposer.test.tsx`, `v2dictationsession.test.tsx`.
- Rendered light/dark captures of the restored Settings switch.
- No server, API, schema, keybinding or speech-backend change. The setting's default stays off.
