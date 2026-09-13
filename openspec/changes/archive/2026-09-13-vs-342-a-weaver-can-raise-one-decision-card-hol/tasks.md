## 1. Shared input model and validation

- [x] 1.1 Add `single_choice` to `DECISION_INPUT_TYPES` in `packages/shared/src/enums.ts`, extend
  `DecisionInputChoice` with `recommended?: boolean` and `DecisionInput` with `description?: string`,
  `default?: string | string[]` and `allowOther?: boolean` in `packages/shared/src/types.ts`; verify
  `pnpm --filter @weave-ai/shared build` succeeds.
- [x] 1.2 Extend `validateInputs` in `packages/core/src/decisions/service.ts`: a `single_choice` needs
  at least two unique choices, and a `recommended` choice or a `single_choice`/`multiselect` `default`
  must be one of that input's choices, else the decision is refused naming the input key; a `secret`
  input with a default is refused. Verify with unit tests in
  `packages/core/src/decisions/decisions.test.ts` covering each refusal.
- [x] 1.3 Extend `validateAnswerInputs` in the same file for `single_choice`: a string that is a
  choice key is recorded as-is; a string that is not a choice is accepted only when the input sets
  `allowOther`, and is then recorded as the human's own words; otherwise it is refused and the
  decision stays open. Verify with unit tests.

## 2. Tool schema and instructions

- [x] 2.1 Extend `AskInputSchema` in `packages/server/src/tools.ts` with `description`, `default`,
  `allowOther`, `recommended` on a choice, and `single_choice` in the type enum; extend the `weave_ask`
  description to say a card may carry several closed-set questions as `single_choice` inputs each with
  its recommendation. Verify `pnpm --filter @weave-ai/server test` (or the tools test) and typecheck.
- [x] 2.2 In `templates/weaver.AGENTS.md.tmpl` (the "Ask with options" and "Ask with inputs" paragraphs)
  and `skills/weave-ai-weaver/SKILL.md`, require one card with one `single_choice` question per input,
  each with its recommendation; never list questions in a chat message; collect an open-ended value
  with a text input rather than prose. Verify `packages/shared/src/tools.test.ts` passes and re-read
  the rendered paragraphs.
- [x] 2.3 Add the matching one-line guidance to `skills/weave-ai-worker/SKILL.md`'s `weave_ask`
  sentence. Verify `packages/shared/src/tools.test.ts` passes.

## 3. Web card rendering

- [x] 3.1 In `packages/ui/src/components/DecisionCard.tsx`, render a `single_choice` input as a
  radiogroup of its choices (label plus description), pre-select the recommended choice, and render
  the free-form alternative when `allowOther` is set; show each input's `description` under its label.
  Verify with component tests in `packages/ui` that the recommended choice is selected before any
  interaction and that the free-form text is taken as the answer.
- [x] 3.2 Initialize the collected values from each input's `default` (and a single-choice's
  recommended choice) so a question with a default renders pre-filled. Verify with a component test.
- [x] 3.3 Map an answered `single_choice` value to its choice label, or show the typed text, in the
  answered-card summary. Verify with a component test that an answered multi-question card shows each
  question with its answer and no controls.

## 4. Other surfaces point at the web card

- [x] 4.1 In `packages/server/src/channels.ts` `decisionCard`, emit no answerable actions and a line
  naming the web app when the decision carries inputs; verify with a unit test that a decision with
  inputs produces no actions and a decision without them is unchanged.
- [x] 4.2 In `packages/cli/src/commands/decision.ts`, refuse to answer a decision carrying inputs and
  name the web card; verify with a CLI test.
- [x] 4.3 Confirm `decisionToCard` in `packages/render/src/decision.ts` keeps `answerElsewhere` true
  for any open card with inputs and the body line reads sensibly for single-choice questions; verify
  with the existing render tests plus a single-choice case.

## 5. Spec and verification

- [x] 5.1 The deltas in `specs/human-decisions/answer-inputs/spec.md` and
  `specs/human-decisions/option-cards/spec.md` are written as part of this change's planning; adjust
  the wording only if implementation shows it wrong.
- [x] 5.2 Run `openspec validate vs-342-a-weaver-can-raise-one-decision-card-hol --json --strict` and
  verify it is clean.
- [x] 5.3 Run `pnpm lint` and `pnpm typecheck`; verify both are clean.
- [x] 5.4 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and verify both pass, including every
  new test above.
- [x] 5.5 Confirm no database migration, HTTP route or MCP tool was added; the change is the input
  model, its validation, the surfaces and the instructions.
