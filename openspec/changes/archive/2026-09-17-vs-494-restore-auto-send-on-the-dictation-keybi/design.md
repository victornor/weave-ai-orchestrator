# Design — vs-494-restore-auto-send-on-the-dictation-keybi

## Context

See `proposal.md` — Why. The state that shapes the approach, after VS-489 (now on `main`):

- `useDictationController` (`packages/ui/src/lib/dictationController.ts`) exposes a single ending,
  `stop()`, which just calls `dictation.stop()` and never sends (VS-489). The queued-send machinery
  it used for auto-send — `pendingSend`/`pendingSendRef`, the settle effect that submits — is still
  present and untouched; only the arming in `stop()` was removed.
- Both gesture families call the same ending today: the composer's dictate control
  (`ChatComposer.tsx`, `Composer.tsx`), the off-page `DictationBar`'s Stop, and the shared
  `useDictationHotkey` release/toggle-off (including its window-blur fallback).
- V2 owns one shared session in `DictationSessionProvider`; its hotkey is bound there, off-chat as
  well as on. V1's `Composer` binds its own local hotkey (`shared === null`).
- VS-489 also added `cancel()` (Escape) and the focused-pane targeting. Both stay exactly as they
  are; this change does not touch them.
- VS-435 (the setting) was a `task` tracker change, so there is no requirement for the setting
  itself — the behaviour lives in `web-v2/chat-composer`.

## Goals / Non-Goals

**Goals:**

- The Stop control never sends, with the setting on or off.
- The keybinding (toggle-off, held release, and the blur fallback for a lost release) submits the
  settled transcript exactly once when the setting is on, and leaves it in the composer when off.
- The preference is restored with the same storage key and semantics, so an existing choice reads
  back.
- V1 and V2 composers behave the same; tests assert submission, not that a handler fired.

**Non-Goals:**

- The setting's default (still off), the chord itself, the speech backend, Escape, and the
  multi-chat focused-pane behaviour.
- A second send implementation: the keybinding ending rides the existing queued-send path so it
  inherits the full draft, attachments, reply target and project scope (VS-282/VS-416/VS-435).

## Decisions

### A second ending path, `stopByChord()`, distinct from `stop()`

Add `stopByChord()` to `useDictationController`: when `autoSend` is on and a submit is allowed and
none is already queued, it sets `pendingSend`, then calls `dictation.stop()`; otherwise it just
stops. It is VS-435's old `stop()` body, made explicit. `stop()` stays the never-send ending for
the Stop control.

Alternative considered: a boolean parameter on `stop()` (e.g. `stop({ autoSend: true })`). Rejected
for the same reason VS-489 rejected an Escape flag: one function with two meanings is what let the
wrong path arm the wrong gesture. Two named endings make the caller's intent reviewable.

### The distinction lives in the callback the hotkey receives, not in the hotkey

`useDictationHotkey` is unchanged. Its `stop` option is already "the way this chord ends a
session", so each caller now passes the keybinding ending there and keeps the never-send ending for
its visible Stop control. This leaves `dictationHotkey.test.tsx` untouched and keeps the chord's
state machine in one place.

The hotkey's window-blur fallback ends a held chord whose keyup was lost, so it is a chord ending
and uses the same callback — this is stated in the requirement. It only fires while the chord is
mid-press (`phase === 'pressed'`); a toggle session is unaffected by blur.

### V1 and V2 both route their endings deliberately

- V2 `DictationSessionProvider`: hotkey `stop` becomes `controller.stopByChord`; the bar's Stop and
  the composer's mic keep `controller.stop`.
- V1 `Composer` (still used by decision cards, the worker page and ticket pages): the mic keeps a
  `stopDictation` that only calls `dictation.stop()`; the hotkey gets a new `stopFromChord` that
  arms the send the way VS-435's handler did, then stops. `send()` keeps calling `dictation.stop()`
  directly so a manual send is never armed twice.

### The setting is restored verbatim; only its Settings copy changes

`dictationAutoSend.ts` returns exactly as it was (key `conductor.dictationAutoSend`, `'on'`/`'off'`,
absent means off, own event for a live change). The switch is restored in `DictationSection`; its
one-line description is corrected to say the keybinding sends and the mic/Stop does not, because
the old copy claimed the mic button auto-sent.

### Discard, empty and error still send nothing

The queued-send effect already drops a discarded (≤5-word, VS-439), empty or errored attempt and
shows the existing notice. The keybinding ending arms the same `pendingSend` state, so it inherits
that unchanged.

## Risks / Trade-offs

- [The keybinding now sends where VS-489 shipped no-send] → the setting is off by default, so only a
  human who turned it on sees the change; tests assert the actual submit and the off-state no-send.
- [Blur auto-sending could surprise] → blur only ends a *held* chord, matching VS-441's "a genuine
  hold stops when the window loses focus"; toggle sessions are untouched. Recorded in the
  requirement so it is a deliberate contract.
- [REPLACED requirement drift] → the ADDED requirement carries every case the removed one covered
  (dictate control, bar Stop, explicit send, Escape) plus the keybinding and setting rules, so the
  main spec does not lose behaviour at archive time.
- [The change is authored on top of VS-489] → VS-489 is on `main` before this branch is delivered;
  rebase before the PR so the diff contains only this change.

## Open Questions

None.
