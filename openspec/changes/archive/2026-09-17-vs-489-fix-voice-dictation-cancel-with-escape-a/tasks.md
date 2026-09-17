# Tasks

## 1. A cancel path that never sends

- [x] 1.1 `packages/ui/src/lib/dictation.ts`: add `cancel()` to the `Dictation` interface and hook. It releases the recognizer or aborts the in-flight `/api/transcribe` request through the existing `abortRef`, then settles the attempt (`transcribing` false, `settled` true) without delivering a further transcript. Verify: `pnpm --filter @weave-ai/ui test dictation` passes unmodified.
- [x] 1.2 `packages/ui/src/lib/dictationController.ts`: add `cancel()` to the controller. It clears `pendingSend`/`pendingSendRef` and `pendingNotice`, stops the reveal, marks the session discarded, calls `dictation.cancel()`, and restores `base.current` (the draft captured at `start()`) to the composer. A long cancelled transcript must be discarded too, not only a short one. Verify: a unit test with a cancelled long transcript asserts the draft returns to its pre-dictation value and `submit` was never called.
- [x] 1.3 `packages/ui/src/v2/DictationSession.tsx`: while the session is listening or transcribing, install a window `keydown` listener that cancels on Escape; remove it when idle. Verify: Escape during listening (auto-send on) and during transcribing each cancel with no submit; no listener is present when idle.

## 2. Dictation targets the focused pane

- [x] 2.1 Thread the focused-pane flag from `packages/ui/src/v2/chats/ChatsPage.tsx` through `V2ChatPage`/`ChatConversation` (`ChatPage.tsx`) to `ChatComposer.tsx`. A non-focused pane's composer SHALL NOT call `registerComposer` and SHALL NOT offer an active dictate control; the focused composer registers as before. Verify: `pnpm --filter @weave-ai/ui test v2chats` plus a new case.
- [x] 2.2 `packages/ui/src/v2/ChatComposer.tsx`: gate the in-composer dictation slot and the shared-controller usage on the composer being the registered (focused) target, not only on a thread-id match. A non-focused pane never shows the recording indicator. Single-chat pages (focused true) behave as today.
- [x] 2.3 `packages/ui/src/v2/DictationSession.tsx`: `startSession` SHALL refuse to retarget or restart a running session, so a second recording never starts from another pane and the target cannot move mid-session. Verify: with a session listening for one pane, focusing another and pressing its dictate control starts nothing and leaves the target unchanged.
- [x] 2.4 `packages/ui/src/v2/DictationSession.tsx`: render the off-page bar from whether the session's target composer is registered (focused and on screen), replacing `path === /w/<ws>/chat`. The bar stays hidden while dictating in the focused pane of the multi-chat view, and still appears on other V2 pages exactly as in VS-450.

## 3. Tests

- [x] 3.1 `packages/ui/src/test/v2dictationsession.test.tsx`: Escape while listening with auto-send on cancels, restores the pre-dictation draft, and asserts `onSubmit` was never called (not merely that a handler fired). Same for Escape while transcribing (Voxtype upload) and for Escape with the off-page bar shown.
- [x] 3.2 Escape's other meanings are intact when no dictation is active: a sheet/separator/dialog still reacts to Escape as before (assert the surface's effect, not that no keydown fired).
- [x] 3.3 `packages/ui/src/test/v2chats.test.tsx`: dictation started while a pane is focused lands in that pane's composer using the in-composer slot; the off-page bar is absent; no non-focused pane shows a recording indicator; focusing a second pane and starting stops the first session (only one records).
- [x] 3.4 Confirm the single-chat behaviour is unchanged: the existing `v2chatcomposer`, `dictation` and `v2dictationsession` suites pass without edits except the new cases.

## 4. Checks and rendered evidence

- [x] 4.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` green from `work/`; paste both suite blocks (core/server and UI) verbatim, never summed and never one presented as both.
- [x] 4.2 Rendered captures, light and dark: Escape cancelling a dictation before it sends, and the multi-chat view dictating into the focused pane with no off-page bar. Open each capture and confirm it shows what was intended before reporting it. Captures live outside `work/` or are committed per the project's convention; `git status --porcelain` in `work/` is empty before review.

## 5. Ending a dictation never sends; auto-send retired (scope addition, 2026-09-17)

- [x] 5.1 `packages/ui/src/lib/dictationController.ts`: `stop()` no longer arms `pendingSend`; it only ends the session, leaving the settled transcript in the draft. An explicit send still queues through `requestSend()`.
- [x] 5.2 `packages/ui/src/components/Composer.tsx` (V1): `stopDictation()` no longer arms the queued send.
- [x] 5.3 Remove the "Send automatically when dictation ends" switch from `packages/ui/src/settings/sections.tsx` and delete `packages/ui/src/lib/dictationAutoSend.ts` (and its test), so no inert setting remains.
- [x] 5.4 Tests: the mic control, the bar Stop, and the chord's release/toggle-off each leave the transcript and submit nothing; the explicit send still submits exactly once; Escape still discards. Verify: `pnpm --filter @weave-ai/ui test v2chatcomposer dictation v2dictationsession` green.
- [x] 5.5 Checks green, and the delivery states plainly that auto-send is retired and that a message now leaves only from the send keybinding or the Send button.
