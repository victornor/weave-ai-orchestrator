## 1. Backend incidents

- [x] 1.1 Item 1: FK failure not reproducible on a freshly migrated DB (`foreign_key_list`/`foreign_key_check` clean, integration test publishes twice); reported with evidence, live-DB state needed
- [x] 1.2 Item 2: `approval_policy=on-request` for auto mode is in `packages/runtimes/codex/src/args.ts` and covered by `test/args.test.ts` and `test/turn.test.ts`; live verification reported as unverified
- [x] 1.3 Item 3: `weave_decision_answer` accepts `inputs` and is covered by `packages/server/test/mcp.test.ts`; reported already fixed
- [x] 1.4 Item 4: not reproduced from code; the watchdog (`supervisor/index.ts`) and shutdown paths (`runs/engine.ts`) classify by run state, not by whether a deliverable landed, so the fix is a design change; reported with a named follow-up
- [x] 1.5 Items 5 and 8: item 5 covered by the boot-time restart and upgrade announcements; item 8 fixed: a differing commit is never accepted as the target (runner `onTarget` and daemon `reconcile`), with a runner test
- [x] 1.6 Item 6: daemon assembles PATH from the login shell (`packages/core/src/tools/host.ts`); reported obsolete
- [x] 1.7 Item 7: `ScheduleWakeup` is denied for Claude workers on purpose (`adapter.ts`); `weave_schedule_wakeup` is the supported path; reported obsolete by design
- [x] 1.8 Item 11: `actionApprovalCoversRevision` and the tests in `tickets.test.ts` (VS-216, VS-225) cover the re-raise loop; reported already fixed
- [x] 1.9 Item 12: worktrees get a committer identity at provisioning; the existing test was fixed so it no longer inherits the caller's `GIT_AUTHOR_*` environment

## 2. UI incidents

- [x] 2.1 Item 9: `WorkerOptionsEditor` in `Models.tsx` edits options; reported already fixed
- [x] 2.2 Item 10: background tabs close their event stream (VS-227) and Live shares the worker feed (VS-372), covered by `connectionBudget.test.tsx`; reported already fixed

## 3. Close-out

- [x] 3.1 Report every item with evidence in the ticket report, and run both test suites
- [x] 3.2 Name the resolution of every incident in the ticket report (workers have no incident-resolve tool, so the weaver resolves them from it)
