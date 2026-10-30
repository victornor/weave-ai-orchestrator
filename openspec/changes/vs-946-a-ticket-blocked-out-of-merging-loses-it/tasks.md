## 1. Detection
- [ ] 1.1 Add `isStrandedMergeBlock` to `packages/shared/src/merge-queue.ts`
- [ ] 1.2 Add the "Needs attention: stranded out of the merge queue" section to the weaver digest in `prompts/index.ts`, with a render test

## 2. Retry
- [ ] 2.1 Restore a merge-blocked ticket before relaunching in `applyRetryApproval` and `tickets.retry`; comment the repair when the restore is refused
- [ ] 2.2 Regression tests for the stranded shape (blocked, `blocked_from_status = merging`, null queue timestamps, answered merge approval) in `merge-queue.test.ts`

## 3. Verify
- [ ] 3.1 Run typecheck, lint and both test suites
