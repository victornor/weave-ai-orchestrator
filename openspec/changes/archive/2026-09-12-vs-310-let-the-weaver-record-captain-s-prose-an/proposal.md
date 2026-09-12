## Why

Captain answers the weaver's questions in conversation, but `weave_decision_answer`
(`packages/server/src/tools.ts:705-711`) refuses any decision the caller does not own, and a
weaver's own question to captain is owned by captain. So the card stays open forever, and because
`templates/weaver.AGENTS.md.tmpl:47` and `skills/weave-ai-weaver/SKILL.md:20` tell an obedient
weaver to echo "Recorded: …", a weaver records nothing while saying it did. Two of the four cards
captain was looking at were stuck in exactly this state. Captain has already made the product call:
for questions only, keep the human's words verbatim, mark the answer as relayed, and link it to the
message it came from — while every approval stays out of reach, in every circumstance.

## What Changes

- `weave_decision_answer` SHALL accept a human-owned decision **only** when its kind is one an
  agent may raise — the exported `ASKABLE_DECISION_KINDS` (`question`, `concern`, `gate_finding`).
  Every approval kind keeps the current `forbidden` error, unchanged. The list is read from that
  constant, never retyped, so a kind added later is refused by default.
- That path SHALL require an argument naming the inbound human thread message the answer came from,
  and SHALL refuse a call naming no message, an unknown message, a message from another thread or
  workspace, an outbound message, or a message not authored by the human. This validation is the
  teeth of the feature: without it a weaver could record an answer captain never gave.
- The recorded answer keeps the human's words **verbatim** in the answer text; the weaver may also
  map them onto one of the decision's option keys, and both are then stored.
- The decision row SHALL make the writer and the author distinct — the row is written by the weaver
  agent, the words are authored by the human — and SHALL link the answer to its message, so a
  relayed answer can never be mistaken for the human's own tap in the database.
- Every surface that shows an answered decision SHALL show that it was relayed and where it came
  from: the card in the conductor chat and Needs you, the TUI/CLI card model, and the durable
  `decisions.md` line when `remember` was set.
- The two instruction files SHALL stop promising anything the tools cannot do: a question or concern
  may be recorded from the human's message, but a plan, merge, or action approval still needs the
  human's own tap and is never recorded from a message.

## Capabilities

### New Capabilities

- `human-decisions/relayed-answers`: which human-owned decisions may be recorded from the human's
  own message and which may never be; the message-naming validation; verbatim text plus an optional
  option key; the writer/author/link provenance; that a relay closes the card and wakes the asker;
  and the durable decisions line it writes.
- `agent-prompts/weaver-relay-instructions`: the conductor/weaver instruction files state that an
  answer given in prose may be recorded for a question or concern by naming the message it came
  from, and that plan, merge and action approvals are never recorded this way.

### Modified Capabilities

- `human-decisions/option-cards`: an answered card that was relayed says so and attributes the
  words to the human rather than showing an answer indistinguishable from the human's own tap.

## Impact

- `packages/shared` — `Decision` gains `answerAuthorKind` and `relayedFromMessageId`; no tool-name
  list changes.
- `packages/db` — migration `0031_relayed_decision_answers.sql` (`ALTER TABLE decisions`, two
  nullable columns; leaf table, no CHECK rebuild). Existing rows read as direct answers.
- `packages/core` — `decisions.answer()` accepts and validates the relay message, records the
  provenance, and `knowledge.appendDecision` marks the durable line.
- `packages/server` — the `weave_decision_answer` MCP handler gains `relayMessageId`, applies the
  askable-only gate and the required-message rule, and its description is updated. The HTTP answer
  route is deliberately untouched: relaying is the weaver's tool, not a human tap.
- `packages/render` / `packages/tui` / `packages/cli` — the shared card model carries the relay so
  the TUI and CLI do not render a relayed answer as the human's own tap.
- `packages/ui` — `DecisionCard` shows the relay on the answered record.
- `templates/weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver/SKILL.md` — the instruction fix.
- `packages/core/src/decisions/decisions.test.ts`, `packages/server/test/mcp.test.ts` — coverage for
  every `DECISION_KINDS` member, driven off `DECISION_KINDS` / `ASKABLE_DECISION_KINDS`.

**Out of scope:** any change to how approvals are answered, raised, reviewed or displayed; letting a
worker relay anything; inferring which message answers a card; dead cards on finished tickets and
the weaver's staleness signal (VS-306).
