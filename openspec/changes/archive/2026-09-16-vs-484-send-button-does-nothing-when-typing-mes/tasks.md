## 1. Fix the composer's send path

- [x] 1.1 In `packages/ui/src/v2/ChatComposer.tsx`, replace the direct `const send = ctl.requestSend` with a callback: while a shared session is dictating for this composer's thread (`sessionHere` and `dictation.listening || dictation.transcribing`), call the shared controller's `requestSend`; otherwise call the local controller's `requestSend`, which submits the composer's own `value` and staged files. Keep `ctl` for the listening/transcribing/reveal/pending display. Verify: `pnpm --filter @weave-ai/ui test v2chatcomposer` passes unmodified.
- [x] 1.2 Confirm the textarea's Enter handler (`send()`) uses the same callback, so Enter and the button behave identically. Verify: the composer send tests still pass.

## 2. Regression tests (`packages/ui/src/test/v2dictationsession.test.tsx`)

- [x] 2.1 Add a test that renders the real `ChatComposer` inside the `DictationSessionProvider` (no dictation started) with a stubbed `onSubmit`, types a message and clicks Send; assert `onSubmit` received the typed text once. This is the VS-484 regression: it fails against the pre-fix code.
- [x] 2.2 Add a test that with a dictation listening for this composer's thread, Send still finishes the dictation and submits the transcript exactly once (the VS-282/VS-416 path is preserved).
- [x] 2.3 Add a test that a dictation targeting another thread does not capture a typed send in this composer: the typed text is submitted to this composer's thread, not the dictation's target.

## 3. Verification and delivery

- [x] 3.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` all green from `work/`; paste both suite blocks (core/server and UI) verbatim into the report, never summed and never one presented as both.
