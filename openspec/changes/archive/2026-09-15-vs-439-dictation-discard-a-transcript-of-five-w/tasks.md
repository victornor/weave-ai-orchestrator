# Tasks

- [x] 1. Add `DICTATION_MIN_WORDS = 6` and `isDictationTooShort()` to `packages/ui/src/lib/dictation.ts` — whitespace-separated tokens holding at least one letter or digit; punctuation-only tokens don't count.
- [x] 2. V1 `packages/ui/src/components/Composer.tsx`: apply the rule when the session settles — insert nothing, restore the draft from before the mic opened, and clear a queued or auto-armed send instead of submitting the old draft.
- [x] 3. V2 `packages/ui/src/v2/ChatComposer.tsx`: same rule, and never start the VS-425 reveal on a discarded result.
- [x] 4. Tests: `packages/ui/src/test/dictation.test.tsx` and `packages/ui/src/test/v2chatcomposer.test.tsx` (five vs six words, punctuation-only tokens, prior typed text preserved, queued/auto send cleared, no reveal, a failed transcription showing its error), plus the pure rule in `packages/ui/src/test/dictationRule.test.ts`.
- [x] 5. Evidence and checks: `pnpm lint`, `pnpm typecheck` and both test suites green with output pasted; a written walk-through of the discard and keep cases against a stubbed dictation.