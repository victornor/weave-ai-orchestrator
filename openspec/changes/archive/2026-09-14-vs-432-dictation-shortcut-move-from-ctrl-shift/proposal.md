# Dictation shortcut moves to Ctrl+Shift+Space

Tracker change for [VS-432](weave://tickets/VS-432). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: move voice dictation off ⌘/Ctrl+Shift+M and onto **Ctrl+Shift+Space**, with
both interaction styles on the one chord — a quick press toggles, a long hold is push-to-talk.

`⌘⇧M` was push-to-talk only and, worse, `M` is a real letter: the chord is awkward to reach and
easy to collide with typed text. `Space` is where a push-to-talk key belongs. But a plain
press-and-release toggle is what a desk user wants for a long dictation ("press once, talk, press
again"), and the existing model only ever held the key down.

Today the two bindings are written twice and behave differently. V2
(`packages/ui/src/v2/ChatComposer.tsx`) stops on any Space/Meta/Control/Shift keyup whenever it is
listening; V1 (`packages/ui/src/components/Composer.tsx`) keeps a `startedByKey` ref and only stops
a mic the chord itself opened. Both are push-to-talk only, and the two cannot stay in step. The
hint text ("hold ⌘⇧M to dictate") also only ever described the hold.

## What changes

- **One shared state machine**, `packages/ui/src/lib/dictationHotkey.ts`, used by both composers:
  - Keydown of Ctrl (⌘ on a Mac) + Shift + Space while idle starts dictation and records the press
    time; auto-repeat keydowns are ignored.
  - A keyup of Space or of any held modifier, in any order, decides the mode: held ≥ 1000 ms
    (`DICTATION_HOLD_MS`, one named constant) stops on release; a shorter press stays listening in
    toggle mode.
  - A keydown of the chord while listening in toggle mode stops dictation and ignores that press's
    keyup.
  - The chord is always `preventDefault`ed, so Space never types into the textarea or scrolls the
    page.
  - The hook reports its mode (`off | hold | toggle`) so V1 can say "release … to stop" during a
    hold and "press … again to stop" in toggle mode.
- **V1 and V2 wire the hook**, replacing their two bespoke listeners. `ChatComposer`'s `hotkey`
  prop (VS-428) is kept: a composer that has handed the key to the Plan modal passes `hotkey={false}`
  and the hook is disabled there, so exactly one composer answers.
- **Hints match the accepted input.** `dictationHint()` returns
  `⌘⇧Space to dictate · hold to talk` on a Mac and `Ctrl+Shift+Space to dictate · hold to talk`
  elsewhere, with `tap the mic to dictate` on touch unchanged. The V1 listening row now
  distinguishes hold from toggle.
- **Docs**: PLAN §21.1 and the design contract's Composer bullet and decision 13 are updated. The
  V2 mockup asset `docs/design/v2/Screens.dc.html` is left alone.
- **Tests**: the hook's state machine directly (quick toggle, hold past the threshold, a modifier
  released before Space, auto-repeat, `preventDefault`), plus both composers' wiring and the hint
  text on Mac and non-Mac.

## Out of scope

- The voice meter's runaway width (VS-431) and the dictation reveal animation (VS-425).
- The on-screen mic button and tap-to-toggle on touch: unchanged.
- The keyboard chord on a phone: still none.
