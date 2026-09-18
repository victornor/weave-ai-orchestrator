## 1. One shared dictation control

- [x] 1.1 Add `packages/ui/src/v2/DictationControl.tsx`: a mic control (start/stop, `aria-label`/`aria-pressed`, disabled while transcribing, V2 sizing), an in-progress/notice renderer (listening meter or "Listening…", the transcribing indicator, error and notice lines), and a `useFieldDictation` hook that wraps `useDictationController` for a field with no send. Verify: `pnpm --filter @weave-ai/ui test v2chatcomposer dictation v2dictationsession` passes with only the VS-439 threshold changes below; the extracted pieces match the composer's current markup and states.
- [x] 1.2 Rewire `packages/ui/src/v2/ChatComposer.tsx` to render the shared mic control and in-progress/notice pieces instead of its inline markup, with no behaviour change (shared session, local session, listening/transcribing slots, error and notice). Verify: the same three suites pass unmodified apart from task 3's threshold edits.

## 2. Dictation on the V2 decision card

- [x] 2.1 `packages/ui/src/v2/DecisionCard.tsx`: the free-text answer on a card with options (the `freeText`/`openEnded` textarea) uses a local `useFieldDictation` session and the shared control, inserting after existing text and restoring on a too-short discard. Verify: a new case in the V2 decisions suite starts dictation there and asserts the transcript lands; `pnpm --filter @weave-ai/ui test v2decisions` passes.
- [x] 2.2 `InputControl`: the `text` and `multiline` branches each offer the shared dictation control, with the in-progress state shown in the field's place. Verify: new cases assert a dictate control is present and inserts into each input's value.
- [x] 2.3 `InputControl`: the `single_choice` `allowOther` written answer offers the same control. Verify: a new case selects "Write your own…", dictates, and asserts the transcript lands in that answer.
- [x] 2.4 A `secret` input offers no dictate control. Verify: a new case renders a `secret` input and asserts the dictate control is absent while the other input kinds present it.
- [x] 2.5 Tests for the card dictation: multiline, free-text answer, `text`, `single_choice` `allowOther`, `secret` excluded, insertion into existing typed text, and a below-threshold transcript restoring the field exactly. Verify: `pnpm --filter @weave-ai/ui test v2decisions` green.

## 3. Discard only below three words

- [x] 3.1 `packages/ui/src/lib/dictation.ts`: `DICTATION_MIN_WORDS = 3`, with its doc comment updated to state the rule and that one constant governs both composers and the cards. Verify: a three-word transcript is not flagged and a two-word one is (`dictationRule.test.ts`).
- [x] 3.2 `packages/ui/src/test/dictationRule.test.ts`: pin the new value and rewrite the boundary cases — two words discarded, three inserted, punctuation-only tokens not counted, whitespace collapsed. Verify: the file passes.
- [x] 3.3 `packages/ui/src/test/dictation.test.tsx` (V1) and `packages/ui/src/test/v2chatcomposer.test.tsx` (V2): update the cases, describe titles and comments that state "five words or fewer" / "six words" to the new rule, keeping coverage of discard-restores-the-draft, no reveal, and a queued send submitting nothing. Verify: `pnpm --filter @weave-ai/ui test dictation v2chatcomposer` green.
- [x] 3.4 Sweep every remaining comment and test that states the old number in words rather than referencing the constant (`packages/ui/src/lib/dictationController.ts`, `packages/ui/src/components/Composer.tsx`, `packages/ui/src/test/v2dictationsession.test.tsx`). Verify: a text search finds no "five words" / `DICTATION_MIN_WORDS = 6` claim left in `packages/ui/src`.

## 4. Checks and rendered evidence

- [x] 4.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` green from `work/`; paste both suite blocks (core/server and UI) verbatim, never summed and never one presented as both.
- [x] 4.2 Rendered captures, light and dark, for every UI item: dictation on the free-text answer on a card with options, on a `multiline` input, on a `text` input, on a `single_choice` `allowOther` answer, and the two-word discard versus a three-word insert. Open each capture and confirm it shows what was intended before attaching it with `weave_ticket_attachment_put`; captures live outside `work/`, and `git status --porcelain` in `work/` is empty before review.
