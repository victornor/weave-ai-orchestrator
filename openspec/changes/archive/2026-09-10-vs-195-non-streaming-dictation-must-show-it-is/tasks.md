## 1. `useDictation`: a `transcribing` flag

- [x] 1.1 Add `transcribing: boolean` to the `Dictation` interface (`packages/ui/src/lib/dictation.ts`), backed by state plus a ref (same pattern as `listening`/`wantListening`). Set it `true` synchronously in `stop()` only when the session being stopped was an upload session (`uploadLive.current` was `true`), right where `postWav(wav)` is called. Verify: speech-mode `stop()` never touches it — stays `false` throughout.
- [x] 1.2 In `postWav`, reset `transcribing` to `false` in a single `.finally` covering every branch: a successful response with text, a successful response with empty/falsy text, a 501 (provider unconfigured), any other non-OK response, and a network failure. Verify each branch with a test asserting `transcribing` is `false` after it settles, not just that the existing behaviour (text inserted / error set) still holds.
- [x] 1.3 Guard `start()` against being called while `transcribing` is `true` for upload mode (defense in depth — the composer itself will not offer a way to trigger it, but the hook should not assume that). Verify a direct `start()` call while `transcribing` is a no-op.

## 2. Composer: lock and indicators

- [x] 2.1 In `Composer.tsx`, derive `locked = dictation.mode === 'upload' && (dictation.listening || dictation.transcribing)`. Add it to the textarea's `disabled`, the attach button's `disabled`, and the send button's `disabled` conditions, alongside the existing `disabled`/`submitting` checks. Verify: typing, attaching and sending are all unavailable while `locked`, and available again once it clears.
- [x] 2.2 Disable the mic/stop control specifically during `transcribing` (it must stay enabled during `listening`, where it is the only way to stop). Verify: clicking it while transcribing does nothing; clicking it while listening stops the recording as today.
- [x] 2.3 Replace the single "dictating row" with one that branches on `listening` vs `transcribing` for upload mode: `listening` keeps the meter + elapsed timer and adds an always-visible (not breakpoint-hidden) caption stating both halves — captured now, transcribed once you stop; `transcribing` swaps in a spinner and a distinct "Transcribing…" label, no timer. Speech mode's existing row (meter-less "Listening…" pulse, elapsed timer, desktop-only stop hint) is untouched — it only ever sees `listening`, never `transcribing`. Verify with a rendered-DOM assertion that the two upload-mode states show different content, and that the speech-mode row is byte-for-byte what it was (existing tests must keep passing unmodified).
- [x] 2.4 Border accent (`dictating ? 'border-accent' : 'border-line-2'`) extends to cover `transcribing` too, so the locked state reads as one continuous visual state rather than flickering back to the resting border between stop and the transcript landing.

## 3. Tests

- [x] 3.1 New tests in `packages/ui/src/test/dictation.test.tsx`, upload-mode block: composer locks (textarea/attach/send) the moment recording starts, unlocks on a successful transcript, unlocks with nothing inserted on an empty transcript, unlocks and shows the failure message on a failed request — never left locked in any of the three.
- [x] 3.2 New test: the transcribing indicator appears the moment `stop()` is clicked (before the fetch resolves) and is gone once it resolves; assert it is a different element/text than the listening indicator, not a relabeled one.
- [x] 3.3 New test: the listening indicator's caption is present and not conditionally absent regardless of the viewport helper used elsewhere for the desktop-only hint (i.e. it does not carry the `sm:inline`/`hidden` classes the existing hint does).
- [x] 3.4 Regression test: speech-mode dictation locks nothing — textarea stays editable, send stays available — asserted directly rather than only inferred from existing tests continuing to pass.
- [x] 3.5 Full existing speech-mode suite in `dictation.test.tsx` still passes unmodified (criterion 4: streaming backend unchanged).

## 4. Verification and delivery

- [x] 4.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] 4.2 Screenshots of the listening state and the transcribing state, upload mode, via the no-daemon screenshot harness (`ui-screenshot-harness` knowledge doc) — never against a live daemon or the real Voxtype/Claude credentials. Attach both to the PR.
