## 1. Repair predicate

- [x] 1.1 In `packages/core/src/tickets/service.ts` `repairApprovals()`, after the existing open-approval and missing-`action`-document skips, skip an operational ticket whose current `action` revision already has an `open` or `answered` `action_approval` targeting that revision (missing `target` counts as covering). Leave plan and merge branches unchanged; comment that they terminate by ticket status. Verify: `pnpm exec vitest run packages/core/src/tickets/tickets.test.ts` — existing stranded (no decision row) and "never wrote action" cases still pass.

- [x] 1.2 Add tests in `packages/core/src/tickets/tickets.test.ts` driven from `putDocument('action')` then `decisions.answer`: (a) `approve` then `repairApprovals()` twice → no new `decisions.create` and empty repaired list; (b) `revise` without a new `action` write → no new card; (c) `revise` then a new `putDocument('action')` → a fresh card targeting revision 2; (d) existing YOLO-does-not-answer-repair stranded case still holds. Verify: `pnpm exec vitest run packages/core/src/tickets/tickets.test.ts`.

## 2. Worker contract

- [x] 2.1 Add one sentence to `definitionOfDone('operational')` in `packages/core/src/prompts/index.ts`, the operational row in `skills/agent-conductor-worker/SKILL.md`, and both `templates/brief.md.tmpl` and `templates/worker.AGENTS.md.tmpl`: a wake that is `approve` of an `action` revision that already has a `report` is not a second authorisation to run. Verify: `pnpm exec vitest run packages/core/src/prompts/template.test.ts` still matches the operational done line, and the four files all contain the skip.

## 3. Checks

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Paste **both** suite blocks verbatim in the ticket comment (core/server and UI separately; do not add the totals). Name the reject-the-card workaround in the PR body for anyone mid-loop until this lands.
