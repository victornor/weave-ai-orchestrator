## Context

See `proposal.md — Why`. The pieces the design has to fit:

- `Decision.options` is one flat list; `Decision.inputs` is a JSON array (`inputs_json`, since VS-92)
  typed by `DecisionInput` in `packages/shared/src/types.ts`, validated by `validateInputs`
  (create) and `validateAnswerInputs` (answer) in `packages/core/src/decisions/service.ts`.
- The web card (`packages/ui/src/components/DecisionCard.tsx`) already renders every input in order
  in one section and offers one `Send answer` when there is nothing to choose, so several questions
  on one card is a matter of the new control and defaults, not a new layout.
- The shared card model (`packages/render/src/decision.ts`) already sets `answerElsewhere` for any
  open decision carrying inputs and points at the web app; the CLI/TUI and push consume it.
- The Telegram channel does **not**: `decisionCard` in `packages/server/src/channels.ts` emits
  answerable option buttons whatever the decision carries, so a card with required inputs is pushed
  answerable and its answer is then refused. That is the one surface to bring in line with the
  existing `answer-inputs` requirement.
- No storage or route change: `inputs_json` already holds the shape and
  `POST /…/decisions/{id}/answer` already accepts `inputs` as `Record<string, string | string[]>`.

## Goals / Non-Goals

**Goals:**

- One card can carry several closed-set questions, each with choices, a recommendation and optional
  free-form answer, and be answered in one send.
- Inputs gain a description line and a default value without changing how a card without them reads.
- A single-choice answer reaches the asker as a plain string under the input key, exactly like today's
  inputs, so no asker has to learn a new shape.

**Non-Goals:**

- The V2 UI, and the look of `plan_approval`/`merge_approval`/`action_approval` cards.
- Rendering or editing individual answers on CLI/TUI beyond pointing at the web card; they remain a
  read-and-point surface for value-collecting cards, as the existing requirement already says.
- Auto-answering a decision from its defaults: a default pre-fills the card, it does not decide.

## Decisions

### 1. `single_choice` is an input type, not a second options list

`Decision.options` stays a single flat list for the older one-question card. A closed-set question
raised as one of several is a `DecisionInput` of type `single_choice` carrying its own `choices`.
This keeps `answerInputs` the single path for multi-question answers and reuses every existing
rendering, wake and validation seam. Alternative considered: extending `options` to a list of
question objects — rejected because it forks the answer contract (`answerKey` vs `answerInputs`) and
strands the VS-92 input machinery.

### 2. Free-form "other" is the recorded text, gated by `allowOther`

A `single_choice` input may set `allowOther: true`. The recorded `answerInputs[key]` is the chosen
choice's key; when the human chooses the free-form alternative, it is the text they typed. Validation
accepts a string that is a choice key, or — only when `allowOther` is set — an arbitrary non-empty
string; anything else is refused as "not a choice of input". Alternative considered: a synthetic
`other` choice key plus a separate field — rejected: `answerInputs` is `Record<string, string |
string[]>` and widening it would break every reader for an edge case the asker can already detect by
comparing against its own choice keys.

### 3. Defaults pre-fill the card; the daemon records what was sent

`DecisionInput.default?: string | string[]` is applied by the card as an initial value (text and
multiline: the string; multi-select: the selected keys; single-choice: the selected key). A
recommended single-choice choice is likewise pre-selected. The daemon does not synthesize a value
for an input the human left empty — an optional input left empty stays absent, as today. A secret
input carries no default (there is nothing safe to pre-fill). Alternative considered: the daemon
resolving defaults into the answer — rejected because it would record an answer the human never
gave, and would make "optional and left empty" indistinguishable from "defaulted".

### 4. Validation is symmetric with multi-select

`validateInputs` gains, for `single_choice`: at least two choices, unique keys, and any
`recommended` choice or `default` must be one of the choices. Multi-select gains the matching
default check. `validateAnswerInputs` gains the single-choice branch described in Decision 2. All
refusals name the input key, as the existing ones do.

### 5. Surfaces

- **Web** (`DecisionCard.tsx`): a single-choice control is a radiogroup of the input's choices, each
  with label and description; the free-form alternative is a radio that reveals a text field; the
  input's `description` renders under its label; initial values come from `default` and the
  recommended choice. Several inputs already render as one card with one send; `missing[]` already
  enforces required.
- **Shared model** (`decision.ts`): `answerElsewhere` stays true for any open card with inputs; the
  body line names how many questions rather than "values" when all inputs are single-choice. The
  answered summary (`answeredInputs` equivalent) maps a single-choice value to its choice label, or
  shows the typed text.
- **Telegram** (`channels.ts` `decisionCard`): when the decision carries inputs, emit no answerable
  actions and a line saying the card is answered in the web app — the existing requirement.
- **CLI** (`commands/decision.ts`): answering a card that carries inputs is refused with a pointer to
  the web app, instead of sending an answer missing the values.
- **Push**: already title/context only; no change.

### 6. Instructions

The weaver template and skill gain the rule (one card, one question per input, each with its
recommendation; never a prose list; open-ended values on a text input); the worker skill's
`weave_ask` line matches. The `tools.test.ts` guard over agent-facing prose is the check.

## Risks / Trade-offs

- **A default that is wrong for the human** → it is only a pre-fill, always visible and changeable
  before send; the daemon never treats it as an answer.
- **Free-form text colliding with a choice key** → the asker distinguishes by comparing against its
  own keys; a collision resolves to the choice, which is the safe reading.
- **Telegram stops offering buttons on any card with inputs**, including cards that would have
  "worked" for an all-optional set → matches the existing requirement and avoids a half-answer; the
  pointer is the safe degradation.
- **A card with many questions is long** → it is one card the human can scroll; the alternate (prose)
  is the problem being fixed.

## Migration Plan

No database migration. The change is additive to `inputs_json` values and the tool schema. Deploy is
the normal `weave daemon upgrade` after merge; rollback is the previous release, which reads older
cards unchanged.

## Open Questions

None.
