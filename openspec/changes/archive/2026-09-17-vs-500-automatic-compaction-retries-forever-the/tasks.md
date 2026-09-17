## 1. Consume the automatic-compaction observation

- [x] 1.1 Clear `last_context_tokens` when the shared compaction service starts an out-of-band attempt, preserving existing compacting/error/event transitions for both manual and automatic callers.
- [x] 1.2 Add core regression coverage proving a repeated dispatcher tick invokes compaction once, then dispatches the held wake after completion instead of re-firing.
- [x] 1.3 Add core regression coverage proving a failed attempt persists its reason, clears the compacting mark and context observation, and does not re-fire on the next tick.

## 2. Pin Claude boundary behavior

- [x] 2.1 Extend the Claude fake-CLI/adapter tests with captured boundary and no-boundary command output, asserting only the boundary-bearing result succeeds.
- [x] 2.2 Leave the adapter boundary predicate strict and record the live journal diagnosis in the ticket/PR: 45 attempts at the unchanged 813,725-token observation, two successful boundary reports at 16:41:07Z and 16:42:40Z, followed by 43 no-boundary failures.

## 3. Verify and deliver

- [x] 3.1 Run the focused core and Claude runtime tests, then run both repository test suite blocks required for delivery.
- [x] 3.2 Review the diff, tick all completed tasks, commit the implementation and OpenSpec artifacts with VS-500 in the commit message, and deliver the branch for review.
