# Tasks

## 1. Shared derivations

- [x] 1.1 Add `packages/shared/src/ci-status.ts` exporting `ciChipCopy(delivery, { approvedHead? })`
  returning `null` or `{ tone: 'pending'|'passed'|'failed'|'skipped'|'stale', line, checks }`, from
  `ciState`, `prChecks`, `ciChecks`, `ciHead` and `prHead`: `Waiting for CI · passed/total` naming the
  pending checks, `CI passed`, `CI failed · <name>` naming the first failed check, `CI skipped` (never
  a pass), `CI on an older commit` when `ciHead` and the approved head differ, and `null` when there is
  no rollup. Export it from `packages/shared/src/index.ts`.
- [x] 1.2 Unit-test `ciChipCopy` in `packages/shared/src/ci-status.test.ts`: pending, running (naming
  pending checks), passed, failed (naming the failing check), all-skipped, stale-head, no-rollup, and
  `ciState: 'none'` with no tally.
- [x] 1.3 In `packages/shared/src/weaver-review.ts`, add `WEAVER_REVIEW_WAITING_ON_MAX = 120`, add
  `weaverReviewWaitingOn` to `WeaverReviewFields`, and add `waitingOn: string | null` to
  `WeaverReviewCopy`, populated from the decision for every carrying kind.
- [x] 1.4 Extend `packages/shared/src/weaver-review.test.ts` to assert `waitingOn` is surfaced for
  `looked` and `concerns` and is `null` when absent.

## 2. Decision row

- [x] 2.1 Add `packages/db/src/migrations/0043_decision_review_waiting_on.sql`:
  `ALTER TABLE decisions ADD COLUMN weaver_review_waiting_on TEXT;` with the standard header comment.
- [x] 2.2 Add `weaverReviewWaitingOn: string | null` to `Decision` (`packages/shared/src/types.ts`) and
  map `weaver_review_waiting_on` in `packages/db/src/repos.ts` `decisionRow()`.

## 3. Forge reads the individual checks

- [x] 3.1 Extend `ForgeAdapter.prState`'s return type in `packages/core/src/forge/index.ts` with the
  per-check detail and `packages/core/src/forge/gh.ts` `prState` to return `checkDetails` built from
  the same `statusCheckRollup` (reusing `toCheck`). Update the fake forge to supply it.
- [x] 3.2 Unit-test the mapping in `packages/core/src/forge/gh.test.ts` (names, states, skipped → no
  signal) without calling GitHub.

## 4. Supervisor records it

- [x] 4.1 In `packages/core/src/supervisor/index.ts`, write `ciChecks` (from `pr.checkDetails`) and
  `prHead` (from `pr.headSha`) into `delivery_json` on both refresh paths, alongside the existing
  fields, keeping the `ciChanged` comparison so a checks change still emits `ticket.updated`.
- [x] 4.2 Extend the supervisor tests (`packages/core/src/supervisor/supervisor.test.ts`) to assert the
  new delivery fields are written and that a checks-only change still emits `ticket.updated`.

## 5. Review mark carries `waitingOn`

- [x] 5.1 In `packages/core/src/decisions/service.ts` `review()`, accept `waitingOn`, validate ≤120
  chars (refused with a `validation` error otherwise), and persist it on every mark (absent → `null`,
  replacing any previous value).
- [x] 5.2 Widen the delivery-head reconciliation in `packages/core/src/tickets/service.ts`
  (`noteHeldReviewHead`, or a companion called from the turn-end/reconcile paths) to clear
  `weaverReviewWaitingOn` on any open `merge_approval` whose reviewed head moved, leaving the
  concerns-only wake unchanged.
- [x] 5.3 Core tests in `packages/core/src/decisions/decisions.test.ts` and
  `packages/core/src/tickets/held-review-head.test.ts`: persistence, re-mark replaces/clears,
  over-length refused, head move clears without changing review state or note.

## 6. MCP tool

- [x] 6.1 Add optional `waitingOn: z.string().max(120).nullish()` to `weave_decision_review` in
  `packages/server/src/tools.ts`, pass it through, and update the tool description.
- [x] 6.2 Extend `packages/server/test/mcp.test.ts` to assert the mark stores and clears `waitingOn`.

## 7. Render / cards

- [x] 7.1 Add `waitingOn` to `CardModel` (`packages/render/src/types.ts`), set it in
  `packages/render/src/decision.ts` `decisionToCard`, and emit a review waiting line; test in
  `packages/render/src/decision.test.ts`.
- [x] 7.2 V2 card (`packages/ui/src/v2/DecisionCard.tsx`): add an optional `delivery` prop, render the
  CI chip via `ciChipCopy` on every `merge_approval`, and render the `waitingOn` line from
  `weaverReviewCopy`.
- [x] 7.3 V1 card (`packages/ui/src/components/DecisionCard.tsx`): add the optional `delivery` prop and
  render the same chip and `waitingOn` line.
- [x] 7.4 Pass the ticket's `delivery` from the three surfaces: `NeedsYouPage.tsx`, `ChatPage.tsx`
  (both already hold the ticket rows) and `ticket/Ticket.tsx` (holds the ticket).
- [x] 7.5 UI tests: chip in each state and the `waitingOn` line on the V2 card, on Needs you, in the
  chat pane and on the ticket page (`packages/ui/src/test/v2decisions.test.tsx`,
  `v2needs.test.tsx`, `v2ticket.test.tsx`, `components.test.tsx`), asserting the rendered text/attribute
  rather than that a call happened.

## 8. Docs, skills and evidence

- [x] 8.1 Update `skills/weave-ai-weaver/SKILL.md` and `templates/weaver.AGENTS.md.tmpl`: when a card is
  held up on something external (runner CI, a dependency), mark it and say what it waits on in
  `waitingOn` rather than leaving it unmarked; keep the existing "never a batch / not at turn start"
  rules.
- [x] 8.2 Update `docs/PLAN.md`, `docs/API.md` and `skills/weave-ai-worker/references/tools.md` for the
  new `waitingOn` field and the CI chip.
- [x] 8.3 Capture rendered evidence of a merge card in each CI state and one with a `waitingOn` line on
  Needs you, the chat pane and the ticket page, using a throwaway Vite + headless Chromium harness;
  commit the shots under `docs/reviews/vs-481/` with a README, which is this repo's review-shot
  convention and lands them in the PR (harness files deleted; nothing left untracked).
- [x] 8.4 Run `pnpm lint && pnpm typecheck && pnpm test`; paste both suite blocks verbatim in the PR.
  CI (real green on the self-hosted runner for the exact head) is verified in the merge turn: a draft
  PR runs no CI by design (`ci-workflow`), so it cannot run before the daemon marks the PR ready at
  landing; no job was added or moved to a GitHub-hosted runner.
