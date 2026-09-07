## 1. Shared canonical option-key map

- [x] 1.1 Add a canonical map of decision kind → allowed hard-coded card action keys for
  `plan_approval`, `merge_approval`, `hire_approval` and `discard_approval` to `packages/shared`, and
  verify `pnpm --filter @agent-conductor/shared build` (or `tsc -b packages/shared`) succeeds.

## 2. Fix the daemon's decision creation to cite the shared map

- [x] 2.1 In `packages/core/src/tickets/service.ts`, make both `merge_approval` creation sites (the
  `in_review` transition and `repairApprovals`'s re-raise) and the `plan_approval` creation site cite
  the shared map's keys instead of free-floating literals, and verify `pnpm vitest run packages/core`
  still passes.
- [x] 2.2 In `packages/core/src/roles/index.ts`, make the `hire_approval` and `discard_approval`
  creation sites cite the shared map's keys the same way, and verify `pnpm vitest run packages/core`
  still passes.
- [x] 2.3 Extend `packages/core/src/tickets/tickets.test.ts`'s existing `merge_approval`/`plan_approval`
  assertions, and `packages/core/src/roles/roles.test.ts`'s `hire_approval`/`discard_approval`
  assertions, to check the created decision's `options.map(o => o.key)` against the shared map for
  that kind, and verify these tests fail if a call site's keys are edited to disagree with the map
  (confirm by a throwaway edit, then revert).

## 3. Fix the two broken card buttons

- [x] 3.1 Remove the Hold button from the merge-approval card in
  `packages/ui/src/components/DecisionCard.tsx`, leaving Approve merge as the sole action, and verify
  the merge-approval card in a rendered test shows only that one action.
- [x] 3.2 Change the discard-approval card's Discard button to send the shared map's approval key
  instead of the literal `'discard'`, and verify a rendered test's click sends that key.

## 4. General-rule test

- [x] 4.1 Add a test in `packages/ui/src/test/components.test.tsx` that, for each of
  `plan_approval`, `merge_approval`, `hire_approval` and `discard_approval`, renders the card with a
  `decision()` fixture whose `options` are built from the shared map for that kind, fires every
  rendered action button in turn, and asserts each key `onAnswer` receives is a member of the shared
  map's list for that kind — and verify it passes for all four kinds today.

## 5. Verification

- [x] 5.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test` at the repo root and confirm all three are
  green.
- [x] 5.2 State in the PR description what pressing Hold did before this change (validation error,
  surfaced as a toast, card left unchanged and re-offering the same broken button) and what it does
  now (no Hold button; hiding the card covers the same intent), and the same before/after for Discard.
- [x] 5.3 (found during the AC4 audit, reported rather than fixed here) `packages/render/src/decision.ts`
  — shared by `packages/tui` — has the same class of bug, worse: `merge_approval`'s TUI card always
  offers a non-functional Hold, and `hire_approval`'s/`discard_approval`'s TUI cards' primary buttons
  ("Hire", "Discard", "Keep") always send keys their real decisions do not accept. Filed as VS-114
  (child of this ticket) with full file:line evidence, since fixing it needs its own design pass (a
  different, golden-tested package; the TUI has no hide/dismiss equivalent to VS-72) beyond what this
  change's plan scoped.
