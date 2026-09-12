## Context

See `proposal.md`. The pieces already in place:

- `packages/shared/src/enums.ts:57` exports `ASKABLE_DECISION_KINDS = ['question', 'concern',
  'gate_finding']` and `DECISION_KINDS` (ten values: the three askable kinds plus `approval`,
  `plan_approval`, `merge_approval`, `hire_approval`, `discard_approval`, `retry_approval`,
  `action_approval`). The seven approval kinds are system-raised and human-owned.
- `packages/server/src/tools.ts:724` is the `weave_decision_answer` handler; it executes
  `svc(ctx).decisions.answer(ctx.actor, i.id, { key, text, remember })` after a single owner check
  (`if (d.owner !== 'weaver') throw forbidden`). The HTTP route
  (`packages/server/src/routes/decisions.ts`) is the human's own answer path and does not share that
  check — a human answers their own decisions through it.
- `packages/core/src/decisions/service.ts`'s `answer()` writes `answeredByKind: actor.kind`,
  `answeredById: actor.id`, `answerKey`, `answerText`, then applies the per-kind side effect, then
  wakes `askedByAgentId`, then optionally appends to the knowledge base.
- Thread messages live in `thread_messages` with `direction` (`inbound`/`outbound`) and
  `authorKind`/`authorId`; a message's thread reaches its workspace through
  `channel_threads.channel_id → channels.workspace_id`.
- The web card is `packages/ui/src/components/DecisionCard.tsx` (chat, Needs you, ticket page); the
  TUI/CLI card is `decisionToCard` in `packages/render/src/decision.ts`, whose `CardModel.answer`
  feeds `packages/tui/src/components/DecisionCard.tsx` and `packages/cli/src/commands/decision.ts`.
- The durable line is `knowledge.appendDecision` (`packages/core/src/knowledge/service.ts:763`).
- Migrations end at `0030_weaver_artifacts.sql`; `0031` is free. `packages/db/src/db.ts` maps
  snake_case columns to camelCase automatically.

## Decisions

### Decision 1 — The row records writer and author separately, linked to the message

`answeredByKind` / `answeredById` already mean "who ran the answer", and for a relay that is the
weaver agent. The ticket's honest reading is that the *writer* is the agent and the *author* is the
human, so the row keeps the writer where it is and grows:

- `answer_author_kind TEXT` — set to `'human'` on a relay; `NULL` on a direct answer, whose author
  is its writer.
- `relayed_from_message_id TEXT` — the inbound human `thread_messages` row the answer was
  transcribed from; `NULL` on a direct answer.

Two columns, matching the ticket's "one more field and a link". The link is the definitive flag:
`relayed_from_message_id IS NOT NULL` is the one thing a query or a surface checks, so a relay can
never be read as a tap. The author's *identity* is the linked message's `author_id`, so it is
deliberately **not** copied into a third column — that would be a second source of truth for a fact
the link already carries, free to drift. (The alternative of flipping `answered_by_kind` to
`'human'` for a relay and adding a `relayed_by_agent_id` was rejected: it would make every existing
"the human answered this" query silently true for a relay, which is exactly the mistake the ticket
forbids.)

`NULL` author on a direct answer is not an ambiguity: a direct answer's author *is* `answered_by_kind`
and `answered_by_id` by definition, and it has no link. A relay always has both columns set.

### Decision 2 — The owner/kind gate lives in the tool; the message validation lives in the service

The askable-only rule is a property of the agent-facing tool — it is what stops the weaver reaching
an approval — so it belongs in the `weave_decision_answer` handler, next to the existing owner
check. The handler keeps the exact `forbidden` error for every non-askable human-owned kind, so the
behaviour for approvals is byte-for-byte unchanged.

The message-naming validation needs the database (does the message exist, is it in this workspace,
is it inbound, is it the human's), so it belongs in `decisions.answer()` where every other
answer-shape check lives. The service accepts an optional `relayFromMessageId`; when present it
resolves and validates the message before anything is written, and records the provenance in the
same transaction as the answer. When absent, `answer()` behaves exactly as today.

The service also refuses `relayFromMessageId` on a weaver-owned decision (a relay names the human's
message; it is meaningless for a card the weaver owns), refuses it on a human-owned *approval*, and
above all refuses it unless the caller is the workspace's weaver agent (`actor.id ===
conductorId()`). That last check is not redundant with the tool's `scope: 'weaver'`: the scope is an
authorisation check in a different layer, and a worker relaying an answer the human never gave is
the precise abuse this feature must be incapable of. The service-level check makes it structurally
impossible rather than merely unreachable, so no future caller of `answer()` can write a relay.

### Decision 3 — The message must be a real inbound human message in this workspace

One query joins `thread_messages → channel_threads → channels` and filters `channels.workspace_id`.
It returns `not_found` for a message that is unknown or in another workspace, and `validation` for a
message that exists in this workspace but is outbound or not authored by the human. Scoping in the
query itself (not checked after the fact) is the pattern `threads.message()` already uses, and it
makes "does not exist" and "exists elsewhere" indistinguishable to the caller.

### Decision 4 — Verbatim text, optional option key, unchanged side effects

`answerText` is stored from the supplied text with no normalisation. The existing option-key check
stays in force: a key that is not one of `d.options` is refused. The per-kind side-effect switch is
untouched, so a relayed `question` does exactly what a directly-answered question does (today that
is only the runtime-migration special case), the asker is woken, and the `decision.answered` event
fires. `remember` writes the durable line with an added `(relayed from a message)` marker.

### Decision 5 — Every answered-decision surface shows the relay

- `DecisionCard.tsx` (web): when `relayedFromMessageId` is set, the answered record says the words
  are the human's and that the weaver recorded them from the human's message.
- `CardModel.answer` (render, consumed by TUI and CLI): carries the relay so those surfaces do not
  drift into showing a relay as a tap.
- `knowledge.appendDecision`: the `decisions.md` line names the relay.

### Decision 6 — The instruction fix is a requirement, not a note

The behaviour the ticket actually observes is the weaver saying "Recorded" while recording nothing.
A spec requirement in `agent-prompts/weaver-relay-instructions` asserts both files say a question's
prose answer *is* recorded by naming the message, and that plan, merge, and action approvals are
never recorded from a message. The existing `skills/`/`templates/` guard
(`packages/shared/src/tools.test.ts`) already fails any `weave_*` token or stray `ac_*` in
agent-facing prose, so both files stay in that net.

## Migration

`0031_relayed_decision_answers.sql`: two `ALTER TABLE decisions ADD COLUMN` statements (both
nullable, no default needed). `decisions` has had columns appended this way since `0013`; nothing
here touches a CHECK, so no rebuild and no foreign-key caveat. A foreign key on the message id is
deliberately not declared — the id is validated at write time, and the message table is not a
parent this table needs a cascade from.

## Risks

- Adding required fields to the shared `Decision` type touches every Decision literal in tests
  (`packages/ui/src/test/factories.ts`, `packages/render/src/decision.test.ts`,
  `packages/core/src/knowledge/knowledge.test.ts`, `packages/ui/src/test/events.test.ts`). The
  package tsconfigs only include `src`, so these surface when the suite runs, not at typecheck.
- The `weave_decision_answer` description is what the weaver reads; if it does not say the relay
  argument is required for a human-owned question, the weaver will omit it and hit the refusal. The
  description is updated in the same task as the handler.
