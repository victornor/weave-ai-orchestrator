## 1. Shared enums and DB

- [x] 1.1 Add `concern` to `DECISION_KINDS`, add `ASKABLE_DECISION_KINDS = ['question', 'concern', 'gate_finding']` with its type, and add `ticket_blocked` to `WAKE_SOURCES` in `packages/shared/src/enums.ts`. Verify `pnpm typecheck` on `packages/shared` and every package importing these.
- [x] 1.2 Add a new migration rebuilding `decisions.kind`'s CHECK to admit `concern`, following `0010_decision_kinds.sql`'s recipe with the table's current full column list (base columns plus `project_id`, `inputs_json`, `answer_inputs_json`). Verify `packages/db/src/migrations.test.ts`'s existing `keeps the persisted kind CHECK and DECISION_KINDS in step` test and the `DECISION_KINDS` round-trip insert test both pass with no test-file changes needed.

## 2. Decision ownership

- [x] 2.1 Change `defaultOwner` in `packages/core/src/decisions/service.ts` to take `askedByAgentId` and resolve `question`/`concern` by the asking agent's kind (`worker` → `conductor`, otherwise → `human`); keep `gate_finding` unconditionally `conductor`. Pass `input.askedByAgentId` into the call from `create()`.
- [x] 2.2 In `packages/server/src/tools.ts`, narrow `AskSchema.kind` to `z.enum(ASKABLE_DECISION_KINDS)` and stop the `ac_ask` handler from passing `owner` explicitly — let `create()` resolve it. Rewrite the tool's description to explain: a worker's ask always lands on the conductor whichever of `question`/`concern`/`gate_finding` it names; `concern` needs no options; the conductor's own use of the tool still reaches the human.
- [x] 2.3 Add/extend tests in `packages/core/src/decisions/decisions.test.ts`: a `question` (and a `concern`) raised with `askedByAgentId` set to a worker resolves to `owner: 'conductor'` and enqueues an immediate wake to the conductor; the same raised with `askedByAgentId` set to the conductor (or omitted) resolves to `owner: 'human'`; `gate_finding` stays `conductor`-owned regardless of asker. Also fixed `yolo.test.ts`'s pre-existing assertion that encoded the old (buggy) behavior.
- [x] 2.4 Add a test (wherever `ac_ask`'s tool handler is exercised, e.g. a tools/route test) asserting the schema rejects `kind: 'plan_approval'` (and the other four system kinds, and `approval`) before any decision is created.

## 3. Blocked-ticket wake

- [x] 3.1 In `packages/core/src/tickets/service.ts`'s `transition()`, wake the conductor immediately (`wake(conductorId(), 'ticket_blocked', ...)`) when `to === 'blocked'` and `input.unblock?.owner === 'conductor'`.
- [x] 3.2 Add tests in the tickets service test suite: transitioning a ticket to `blocked` with `unblock: { owner: 'conductor', action: ... }` enqueues an immediate wake to the conductor naming the ticket; transitioning to `blocked` with `unblock.owner: 'human'` (or via `blockedBy` with no `unblock`) does not enqueue that wake.

## 4. Rendering `concern`

- [x] 4.1 Add `'concern'` to `CardVariant` in `packages/render/src/types.ts`.
- [x] 4.2 In `packages/render/src/decision.ts`, map `concern` to itself in `VARIANTS`, give it an empty `DEFAULTS` entry, and include it alongside `question` in the free-text-options branch and the `allowFreeText`/`freeTextLabel` defaults.
- [x] 4.3 Add a `concern` entry to the `HEAD` map in `packages/ui/src/components/DecisionCard.tsx` (label distinct from `question`'s "Worker question", e.g. "Worker needs help"; status `blocked`, matching `question` and `gate_finding`).
- [x] 4.4 Extend `packages/render/src/decision.test.ts` with a `concern` case mirroring the existing `question` coverage: free text allowed, no forced options, provided options still render if given.

## 5. Docs and skills (AC7)

- [x] 5.1 Update `templates/worker.AGENTS.md.tmpl` (and regenerate/check `skills/agent-conductor-worker/SKILL.md` if it is derived, otherwise edit both) to say plainly: a worker's `ac_ask` always reaches the conductor, never the human, whatever kind is named; use `concern` when the situation is "I'm stuck" rather than a decision with real options; never address the human.
- [x] 5.2 Update `templates/conductor.AGENTS.md.tmpl` and `skills/agent-conductor-conductor/SKILL.md` to describe handling a worker's `question`/`concern`/`gate_finding`: decide it directly with `ac_decision_answer` when unambiguous, or escalate by raising the conductor's own `ac_ask` to the human and telling the worker with `ac_worker_message` that it is waiting on the human — never leaving the worker's decision open with no signal.
- [x] 5.3 Update `docs/PLAN.md`: the `decisions` table's `kind` enum list, the ownership-policy paragraph, and the `ac_ask` tool signature description, to reflect `concern` and the asker-based ownership rule. Also noted the immediate `ticket_blocked` wake next to the heartbeat digest bullet it now bypasses, and added `concern` to the wakeups source and YOLO-untouched-kinds lists. (`docs/prompts/conductor.AGENTS.md` and `docs/prompts/worker.AGENTS.md.tmpl` are marked superseded drafts in their own header and were left alone.)
- [x] 5.4 Update `docs/SCENARIOS.md`'s worked examples if any wording now reads as stale (its existing `gate_finding` example stays correct; check whether a `concern` example is worth adding alongside it). Added one right after it, in the same "worker gets stuck" section.

## 6. Verification

- [x] 6.1 `pnpm lint && pnpm typecheck && pnpm test` green across the whole repo.
- [x] 6.2 Confirm every acceptance criterion in the ticket against the final diff: worker asks of every kind resolve to conductor ownership and wake it immediately; a worker cannot construct a human-owned or system-owned decision by choosing a kind; a blocked-on-conductor ticket wakes it immediately; an answer reaches the asking worker without a relaunch; nothing about plan/merge/hire/discard approval ownership or raising changed; the worker- and conductor-facing docs say what they now do.
