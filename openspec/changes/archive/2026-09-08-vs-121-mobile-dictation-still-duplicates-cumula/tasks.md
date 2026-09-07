## 1. Capture

- [x] 1.1 Add an in-memory, capped, per-session capture log to `useDictation` recording `{kind:'result', resultIndex, entries:[{isFinal,transcript}], sessionTextAfter, composerTextAfter}` for every `onresult`, and `{kind:'end', restarted, committedAfter}` for every `onend`, and `{kind:'start'}` on each `start()` — verify with a unit test that a scripted event sequence (including a restart) produces the expected log, byte for byte.
- [x] 1.2 Verify, with a test asserting on existing dictation test scenarios, that adding the capture changes nothing about `dictation.listening`, the composer's text, or any existing assertion — the capture only reads, never alters control flow.
- [x] 1.3 Cap the log (e.g. last 500 entries) and verify with a test that recording past the cap drops the oldest entries rather than growing unbounded.

## 2. Opt-in and export

- [x] 2.1 Add an off-by-default toggle (settings- or debug-level) that gates recording; verify with a test that no capture is recorded while the toggle is off, and that turning it on mid-app-session starts an empty log rather than backfilling anything from before.
- [x] 2.2 Add a copy-to-clipboard control, shown once the log is non-empty, that writes the capture's contents as text; verify with a test that activating it calls the clipboard API with the captured content and nothing else.
- [x] 2.3 Verify by reading the diff that no network call or server route carries the capture's contents — this feature has no server side.

## 3. Verification and delivery

- [x] 3.1 `pnpm typecheck`, `pnpm lint`, `pnpm test` all green, including every pre-existing `dictation.test.tsx` case unchanged.
- [x] 3.2 PR description states plainly that this ships diagnostics, not the fix, and asks captain to enable it, dictate the sentence from the original report, and paste back the exported log as a comment on the ticket so the follow-up can be scoped from evidence instead of a guess.
