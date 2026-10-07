## 1. Landing sequence

- [x] 1.1 Add `missingChangeIsOk` and `onArchiveSkipped` to `attemptArchiveThenMerge`; skip the archive when the change is absent from `changes/` and the archive and the opt is set
- [x] 1.2 `mergeDone` passes `missingChangeIsOk` for `task` tickets and writes the "no OpenSpec change; archive skipped" status comment

## 2. Tests

- [x] 2.1 Task ticket, no change directory: merges, skip callback fired, no archive commit
- [x] 2.2 Task ticket with a change archives as before; change ticket with a missing change still throws `openspec_archive_blocked`
- [x] 2.3 `mergeDone` service test records the skip comment and the ticket goes `done`
- [x] 2.4 `pnpm lint`, `pnpm typecheck` and `pnpm test` green, both suite blocks pasted
