## 1. Transition graph

- [x] 1.1 In `packages/shared/src/transitions.ts`, add the direct completion edges: `in_review` to
      `CHANGE.approved`; `in_review` and `done` to `TASK.todo`; `done` to the scout map's `todo`
      (used by `scout`, `question` and `operational`). Update the file's header comment only if it
      asserts a required intermediate. Verify with `pnpm --filter @weave-ai/shared exec vitest run`
      and by reading the three arrays.
- [x] 1.2 In `packages/core/src/tickets/service.ts`, expand the `started_at` stamp condition from
      `to === 'proposing' || to === 'in_progress'` to every status that means work has begun
      (`proposing`, `in_progress`, `in_review`, `merging`, `done`; not `approved`). Verify with the
      test added in 2.5.

## 2. Behavior pinned per kind

- [x] 2.1 In `packages/core/src/tickets/tickets.test.ts`, add a test that a `change` ticket in
      `approved` with a recorded work product transitions directly to `in_review` and raises a
      `merge_approval`, with no `in_progress` step. Verify with
      `pnpm --filter @weave-ai/core exec vitest run tickets.test.ts`.
- [x] 2.2 Add a test that a `task` ticket in `todo` with a work product reaches `in_review`, and a
      `task` in `todo` with nothing to land reaches `done` when its ending is stated; and that the
      same `done` is refused without a note (`validation`) or with unlanded commits
      (`worktree_not_landed`). Verify with the same command.
- [x] 2.3 Add tests that `scout`, `question` and `operational` tickets in `todo` reach `done`
      directly, and that an `operational` ticket still rejects `proposing`, `proposed`, `approved`,
      `in_review` and `merging` as graph-invalid. Verify with the same command.
- [x] 2.4 Rewrite the VS-209 test that asserts `change approved → in_review` is rejected so that it
      uses a still-invalid transition (`change approved → merging`) and still asserts
      `details.allowed` equals `TRANSITIONS.change.approved` without `merging`. Verify with the same
      command.
- [x] 2.5 Add a test that a ticket delivered directly (never entering `in_progress`) records
      `started_at` at the delivery transition. Verify with the same command.

## 3. Contract and instructions

- [x] 3.1 Update `docs/PLAN.md`: §6.2's `in_progress`/`approved` rows to say `in_progress` is
      optional and not a precondition of delivery; §12.2's flow to show `approved → in_review` as a
      valid delivery; §12.3's task/scout/question/operational flows to show the direct finish.
      Verify by reading each changed section against the shipped graph.
- [x] 3.2 Add a new `docs/adr/0022-*.md` recording that the forced `in_progress` step went, what was
      checked for a dependency, and the consequences, superseding the `in_progress`-specific details
      in ADR 0016/0017 only where they differ. Verify by reading it against the graph.
- [x] 3.3 Update the worker-facing instructions to teach the direct ending and stop implying
      `in_progress` is mandatory: `skills/weave-ai-worker/SKILL.md`'s status table and task-ending
      section, `skills/weave-ai-scout/SKILL.md`'s flow line, `skills/weave-ai-openspec/SKILL.md`'s
      mapping table, and `templates/worker.AGENTS.md.tmpl`'s per-status list. Verify by reading each
      against the shipped graph and by the prose guard test in `packages/shared/src/tools.test.ts`.

## 4. Verification

- [x] 4.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test` at the repo root; fix anything that
      regresses and paste both suite blocks verbatim in the delivery.
- [x] 4.2 Run `openspec validate vs-541-a-finished-change-ticket-cannot-go-strai --strict --json`
      and confirm it is clean.
