## 1. Liveness classification

- [x] 1.1 Add `'idle'` to `RUN_LIVENESS` in `packages/shared/src/enums.ts`, and update `classifyLiveness` (`packages/core/src/runs/engine.ts:106-117`) so `report.state === 'idle'` returns the new `'idle'` value instead of `'empty'`. Verify with a `packages/shared` unit test/type check that `'idle'` is a member of `RunLiveness`, and an `engine.test.ts` case asserting a run whose terminal report is `{state: 'idle', ...}` is finalized with `runs.liveness === 'idle'`.
- [x] 1.2 Confirm, with an `engine.test.ts` case, that a report which fails to parse (e.g. missing `knowledge`) is unaffected: its run's `liveness` is still `'empty'`, exactly as `knowledge-reporting`'s existing tests already require.

## 2. Observable evidence

- [x] 2.1 Add an evidence lookup in `packages/core/src/runs/engine.ts` (near `finalize`) that, given a `runId` and the ticket snapshot loaded at the start of the run, checks: a `ticket_comments` row with that `run_id`, a `ticket_document_revisions` row with that `run_id`, a `ticket_work_products` row with that `run_id`, a `knowledge_revisions` row with that `run_id`, or the ticket's current `status` (re-read from `tickets`) differing from the snapshot's `status`. Verify with unit tests covering each of the four table lookups independently (one row present in exactly that table is enough to report evidence) and the ticket-status-changed case.
- [x] 2.2 Confirm, with an `engine.test.ts` case, that a run with no rows in any of those tables and an unchanged ticket status reports no evidence.

## 3. The gate

- [x] 3.1 Rewrite the three-consecutive-turns check (`engine.ts:516-528`) to count a run against the worker only when: its `liveness` is `'empty'` or the new `'idle'`, it has no observable evidence (task 2.1), and the ticket's status at that run's finalize time was one where the worker was expected to act (i.e. not `proposed`, `in_review`, or `blocked`). Verify with an `engine.test.ts` case reproducing the incident shape: a run whose report fails to parse but which posted a ticket comment (or opened a work product / wrote a document / recorded knowledge) under its `run_id` — three of these in a row do not raise a `gate_finding`.
- [x] 3.2 Verify, with an `engine.test.ts` case, that three consecutive `idle` (or empty) turns while the ticket is `in_review` do not raise a `gate_finding`, and that the same worker trips the gate once its ticket moves to a status where it is expected to act (e.g. `in_progress`) and it then produces three turns with no evidence and no valid report.
- [x] 3.3 Verify, with an `engine.test.ts` case, that the gate still fires for a genuinely inert worker: three consecutive runs with no report, no evidence, and a ticket status the worker was expected to act on — confirming the existing "three empty turns" regression case still passes under the new logic.
- [x] 3.4 Add a test pair demonstrating the reporting channel is not the deciding factor: (a) a run whose only reporting is a valid terminal structured report (no mid-turn `ac_report` call) is `'advanced'` and never counted toward the gate; (b) a run that also calls `ac_report` mid-turn (producing a `ticket_comments` row for that run) *and* ends with the same valid terminal report is likewise `'advanced'` and never counted — both pass on the strength of the terminal report and/or the evidence check, not on which channel was used.

## 4. Tool description and docs

- [x] 4.1 Update `ac_report`'s description in `packages/server/src/tools.ts:347` to stop claiming it "updates liveness"; state instead that it posts a status comment (which counts as evidence toward the stuck-worker gate under this change) and does not itself set a run's liveness.
- [x] 4.2 Update `docs/PLAN.md` §9.4's liveness paragraph (around line 684) and the `runs` table field list (line 357) to document the `idle` liveness value and the evidence/ticket-status-based gate, replacing the "digest or timer wake" exemption text that was never implemented.

## 5. UI/CLI surfaces

- [x] 5.1 Add `idle` to `LIVENESS_TEXT` in `packages/ui/src/routes/Runs.tsx` (`idle: 'correctly idle'`) so it renders a label instead of falling back to the raw value; `packages/ui/src/routes/RunPage.tsx` and `packages/cli/src/commands/runs.ts` already print `liveness` as a raw string with no special-casing, so the new value needs no change there.

## 6. Verification

- [x] 6.1 `pnpm typecheck && pnpm lint && pnpm test` green (core 1790 passed/1 skipped, ui 1061 passed).
- [x] 6.2 Grepped every reader of `runs.liveness` outside `engine.ts`/`enums.ts`/`types.ts` (`supervisor/index.ts`, `cli/src/commands/runs.ts`, `server/src/inspect.ts`, `ui/src/routes/RunPage.tsx`, `ui/src/routes/Runs.tsx`): none exhaustively switch on it — `supervisor/index.ts:354` is an `.includes()` membership check unaffected by a new member, the rest pass the raw string through or (Runs.tsx) fall back to the raw value for an unmapped key. Nothing else needed fixing.
