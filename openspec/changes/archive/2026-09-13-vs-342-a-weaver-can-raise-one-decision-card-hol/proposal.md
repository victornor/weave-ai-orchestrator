## Why

On 2026-09-13 the weaver sent captain four open questions about the V2 UI — how V2 is served, which
V1 screens are dropped, the Work column mapping, where new backend work goes — as one prose chat
message, each with its own default and alternatives. Captain's reply: decisions should be surfaced,
not listed as prose; a complex decision with several questions and several choices must be
answerable as a card.

Today `weave_ask` holds a single closed-set question (`options`) plus optional `inputs`, and an input
can be text, multiline, multiselect or secret. There is no single-choice input, no recommended or
default value on an input and no per-question context line, so a card cannot read
"Question 1: A / B / C (recommended B); Question 2: …" and the weaver falls back to prose, where the
decision is not surfaced and is easily lost in the conversation.

## What Changes

- **A single-choice input type.** It carries a set of choices, each with a label and an optional
  one-line description. One choice may be marked recommended and shows pre-selected. An optional
  free-form "other" lets the human type their own answer.
- **Richer inputs.** Every input may carry a short context line shown under its label, and a default
  value where it makes sense — pre-filled text, a pre-selected multi-select or single-choice answer.
- **One-submit cards holding several questions.** A card with several such inputs renders cleanly on
  `Needs you` and in the chat, is answerable in one send, and enforces required questions. The
  answered card shows each question with the answer it was given.
- **Answers reach the asker unchanged.** They still arrive as `answerInputs` keyed by input key. A
  single-choice answer is the chosen key, or the human's own text when "other" is used.
- **Surfaces that cannot collect values point at the web card.** The existing `answer-inputs`
  requirement already says this; Telegram's decision card is the surface that does not honour it yet
  and is brought in line. CLI/TUI and push already point at the web app.
- **Instructions say to use it.** The weaver template and the weaver skill say: when captain needs
  answers to one or more closed-set questions, raise **one** card with one question per single-choice
  input, each with its recommendation; never list questions in a chat message; open-ended questions
  use a text input rather than prose where possible. The worker skill's `weave_ask` guidance gets the
  matching line.

## Capabilities

### New Capabilities

_None. This extends the existing input and card contract._

### Modified Capabilities

- `human-decisions/answer-inputs`: adds the single-choice input type, a per-input context line and
  default value, cards that hold several questions answerable in one send, and how those answers
  round-trip and render.
- `human-decisions/option-cards`: a closed-set question — one or several — is raised as a card, and an
  open-ended need is collected with a text input on a card rather than asked in prose.

## Impact

- `packages/shared/src/enums.ts` — `single_choice` added to `DECISION_INPUT_TYPES`.
- `packages/shared/src/types.ts` — `DecisionInputChoice.recommended`, `DecisionInput.description`,
  `.default`, `.allowOther`.
- `packages/core/src/decisions/service.ts` — `validateInputs` and `validateAnswerInputs`.
- `packages/server/src/tools.ts` — `AskInputSchema`/`AskSchema` fields and the `weave_ask` description.
- `packages/ui/src/components/DecisionCard.tsx` — the new control, defaults, descriptions, answered
  summary.
- `packages/render/src/decision.ts` — `answerElsewhere` wording for question-count; answered summary
  where the shared model carries it.
- `packages/server/src/channels.ts` — `decisionCard` points at the web card when the decision carries
  inputs instead of emitting answerable actions.
- `packages/cli/src/commands/decision.ts` — refuse to answer a card carrying inputs and name the web
  app.
- `templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md`,
  `skills/weave-ai-worker/SKILL.md` — the instruction edits.
- No database migration, no HTTP route and no MCP tool is added; `inputs_json` already stores the
  shape and `POST …/decisions/{id}/answer` already accepts `inputs`.
