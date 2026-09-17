# Tasks — vs-494-restore-auto-send-on-the-dictation-keybi

## 1. Restore the per-browser setting

- [x] 1.1 Restore `packages/ui/src/lib/dictationAutoSend.ts` exactly as it was before VS-489:
  `readDictationAutoSend()`, `writeDictationAutoSend(on)` and `useDictationAutoSend()` over
  localStorage key `conductor.dictationAutoSend`, `'on'`/`'off'`, absent means off, publishing on
  `conductor:dictation-auto-send` so a mounted composer follows a live change. Verify: restore
  `packages/ui/src/test/dictationAutoSend.test.ts` (default off, read and mounted; persists; live
  event) and run `pnpm --filter @weave-ai/ui test dictationAutoSend`.
- [x] 1.2 Restore the Settings → Dictation switch in `packages/ui/src/settings/sections.tsx`
  (`useDictationAutoSend` + `writeDictationAutoSend`, `role="switch"`, label "Send automatically
  when dictation ends") and correct its description: the keybinding sends; the mic and Stop leave
  the transcript; stored in this browser. Verify: `packages/ui/src/test/dictationAutoSendSetting.test.tsx`
  toggles the switch and reads the stored value back.

## 2. Give the keybinding its own ending path

- [x] 2.1 `packages/ui/src/lib/dictationController.ts`: re-add `useDictationAutoSend()` and add
  `stopByChord()` — when `autoSend` is on, a submit is allowed and none is already queued, set
  `pendingSend`/`pendingSendRef`, then `dictation.stop()`; otherwise just `dictation.stop()`. Keep
  `stop()` (never sends) and `cancel()` (Escape) unchanged; expose `stopByChord` on
  `DictationController`. Verify: `pnpm --filter @weave-ai/ui test v2dictationsession`.
- [x] 2.2 `packages/ui/src/v2/DictationSession.tsx`: pass `controller.stopByChord` as the shared
  hotkey's `stop`; leave the `DictationBar` Stop and the composer mic on `controller.stop`. The V2
  composer's own local hotkey (`v2/ChatComposer.tsx`) uses `ctl.stopByChord` too; its mic keeps
  `ctl.stop`. Verify: the V2 dictation-session and composer tests pass, including the new cases.
- [x] 2.3 `packages/ui/src/components/Composer.tsx` (V1): keep the mic's `stopDictation` as a bare
  `dictation.stop()`; add `stopFromChord` that arms the queued send when auto-send is on and the
  composer can send, then stops, and pass it to `useDictationHotkey`. `send()` keeps calling
  `dictation.stop()` directly. Verify: `pnpm --filter @weave-ai/ui test dictation`.

## 3. Tests assert the message was submitted

- [x] 3.1 `packages/ui/src/test/dictation.test.tsx` (V1 composer): with the setting on, a hold
  release and a toggle-off each call `onSubmit` once with the settled transcript (speech and
  upload paths); the mic Stop submits nothing with the setting on; with the setting off both chord
  shapes submit nothing and leave the transcript. Verify: the suite runs green.
- [x] 3.2 `packages/ui/src/test/v2chatcomposer.test.tsx`: with the setting on, a hold release and a
  toggle-off each submit once; the dictate control submits nothing with the setting on. Verify: the
  suite runs green.
- [x] 3.3 `packages/ui/src/test/v2dictationsession.test.tsx`: off-chat, with the setting on, a
  chord ending posts the settled draft to the target thread once; the off-page bar's Stop posts
  nothing with the setting on; Escape still discards and sends nothing; the focused-pane and
  bar-visibility cases are unchanged. Verify: the suite runs green.
- [x] 3.4 Keep `packages/ui/src/test/dictationHotkey.test.tsx` unchanged (the hook's own contract is
  untouched). Verify: it still passes.

## 4. Checks and rendered evidence

- [x] 4.1 From `work/`: `pnpm lint`, `pnpm typecheck` and `pnpm test` all green, with **both**
  suite blocks (core/server and UI) pasted verbatim in the delivery — never summed, never one
  presented as both.
- [x] 4.2 Rendered captures of the restored Settings → Dictation switch in light and dark themes,
  committed under `docs/reviews/vs-494/` (the VS-489 convention) with a README. Open each capture
  and confirm it shows the switch as intended before reporting it; `git status --porcelain` in
  `work/` is empty before review.
- [x] 4.3 Rebase onto `main` (which carries VS-489) before opening the PR, so the diff contains only
  this change; confirm the PR shows the changed files listed in the proposal and nothing from
  VS-489.
