## 1. Provenance on the decision row

- [x] 1.1 Add `answerAuthorKind: string | null` and `relayedFromMessageId: string | null` to the
      `Decision` interface in `packages/shared/src/types.ts`, and add the two nullable columns
      `answer_author_kind TEXT` and `relayed_from_message_id TEXT` to `decisions` in the new
      migration `packages/db/src/migrations/0031_relayed_decision_answers.sql` (`ALTER TABLE`, no
      CHECK rebuild). Confirm `packages/db/src/db.ts`'s camelCase mapping exposes them as
      `answerAuthorKind` / `relayedFromMessageId` on a read, and that an existing row reads both as
      `null`.

## 2. Recording a relay in the decision service

- [x] 2.1 In `packages/core/src/decisions/service.ts`, accept an optional `relayFromMessageId` on
      `answer()`. Refuse it unless the actor is the workspace's weaver agent (`actor.id ===
      conductorId()`), on a decision the weaver owns, and on a human-owned approval. When it is
      present on a valid relay, resolve it with a single query joining
      `thread_messages → channel_threads → channels` scoped to this workspace: refuse `not_found` for
      an unknown or other-workspace message, and `validation` for an outbound message or one not
      authored by the human, before anything is written. Record `answerAuthorKind: 'human'` and
      `relayedFromMessageId` in the same transaction as the answer. When absent, the write is
      byte-for-byte unchanged.
- [x] 2.2 In `packages/core/src/knowledge/service.ts`'s `appendDecision`, append a relay marker to
      the durable `decisions.md` line when `relayedFromMessageId` is set, leaving a direct answer's
      line exactly as it is.
- [x] 2.3 Cover in `packages/core/src/decisions/decisions.test.ts`: the words are stored verbatim;
      a mapped option key is stored alongside them; an offered-but-unknown option key is refused; a
      message that is unknown, other-workspace, outbound, or not the human's is refused and the
      decision stays `open`; a relayed answer sets status `answered`, emits `decision.answered`, and
      wakes the asker; the row marks the writer as the agent, the author as the human, and carries
      the link; a direct answer carries neither; a relay argument on a weaver-owned decision is
      refused; and a relay attempt by any actor other than the workspace's weaver is refused with
      the decision unchanged.

## 3. The weaver's tool

- [x] 3.1 In `packages/server/src/tools.ts`, add `relayMessageId: z.string().min(1).optional()` to
      `weave_decision_answer`'s input and change its handler: for a decision the weaver owns, answer
      directly and refuse a `relayMessageId`; for a human-owned decision, accept it only when
      `(ASKABLE_DECISION_KINDS as readonly string[]).includes(d.kind)` and a `relayMessageId` is
      supplied, otherwise keep the exact current `forbidden` error for a non-askable kind and refuse
      a missing message as `validation`. Update the tool description so the weaver knows a
      human-owned question is recorded by naming the message and that approvals can never be.
- [x] 3.2 Add a test in `packages/server/test/mcp.test.ts` that iterates `DECISION_KINDS`: for each,
      create a human-owned decision of that kind in the harness, call `weave_decision_answer` as the
      weaver, and assert the three values of `ASKABLE_DECISION_KINDS` are recorded from a real
      inbound human message while the seven approval kinds are refused and unchanged. Drive the
      expectation off `DECISION_KINDS` / `ASKABLE_DECISION_KINDS` so a newly added kind fails until
      it is placed.

## 4. Surfaces show the relay

- [x] 4.1 In `packages/ui/src/components/DecisionCard.tsx`, show on an answered card whose
      `relayedFromMessageId` is set that the human's words were recorded by the weaver from the
      human's message; a direct answer renders exactly as before.
- [x] 4.2 In `packages/render/src/decision.ts` / `types.ts`, carry the relay on
      `CardModel.answer`, and render it in `packages/tui/src/components/DecisionCard.tsx` and
      `packages/cli/src/commands/decision.ts` so the TUI and CLI do not show a relay as the human's
      tap.
- [x] 4.3 Update the `Decision` literals the new required fields touch
      (`packages/ui/src/test/factories.ts`, `packages/render/src/decision.test.ts`,
      `packages/core/src/knowledge/knowledge.test.ts`, `packages/ui/src/test/events.test.ts`) and add
      a UI test asserting a relayed answered card says it was relayed while a direct one does not.

## 5. The instructions stop promising what the tools cannot do

- [x] 5.1 Update `templates/weaver.AGENTS.md.tmpl:47` and `skills/weave-ai-weaver/SKILL.md:20`: when
      the human answers a question or concern in prose, record it with `weave_decision_answer`,
      naming the thread message it came from, keeping the human's words; echo "Recorded" only after
      the call actually recorded it. State plainly that a plan, merge, or action approval still
      needs the human's own tap and is never recorded from a message. Run
      `packages/shared/src/tools.test.ts` to confirm no unregistered `weave_*` token was introduced.

## 6. Verification

- [x] 6.1 `pnpm lint && pnpm typecheck` clean.
- [x] 6.2 `pnpm test` green; paste **both** suite blocks (core/server and UI) verbatim with their
      real totals in the delivery report — never one alone, never a retyped combined figure.

> Result (rebased onto `origin/main`, which now carries VS-306 and VS-303): both suites green.
> Core/server: `179 passed | 1 skipped (180)` files, `2684 passed | 1 skipped (2685)` tests. UI:
> `97 passed (97)` files, `1584 passed (1584)` tests. Before the rebase the core run intermittently
> tripped a pre-existing, unrelated cursor-runtime flake
> (`packages/runtimes/cursor/test/liveInput.test.ts`'s 100 ms no-output grace) that also fails
> identically on a `git archive main` copy and passes 3/3 in isolation; it did not fire on the final
> run. Both blocks are pasted verbatim in the delivery report.
