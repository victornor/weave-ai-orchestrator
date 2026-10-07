## Context

`attemptArchiveThenMerge` archives `changeName` onto the ticket branch before merging. When the change directory is absent and not found under `changes/archive/`, `archiveOnBranch` calls `openspec archive`, which refuses, giving `openspec_archive_blocked`. The sequence cannot tell "the worker forgot" from "a task never needed one".

## Decisions

1. **Skip at landing, keep the binding.** The alternative, not binding a name to task tickets, touches ticket creation, the `proposed` gate and the worker brief, and does nothing for task tickets that already carry a name. The name is also reused for the branch and the OpenSpec status mirror. Skipping at landing is one decision in one place and fixes existing tickets too.
2. **Only `task` kind is lenient.** `attemptArchiveThenMerge` gets `missingChangeIsOk?: boolean`, set by `mergeDone` when `t.kind === 'task'`. For a `change` ticket a missing change is a real problem and still throws.
3. **"Missing" means absent from `changes/` and from `changes/archive/`.** That is the same test the retry path already uses (`archivedDirFor`), so a change this sequence archived on an earlier attempt is not mistaken for a missing one.
4. **Recording.** The sequence calls `onArchiveSkipped` once; `mergeDone` writes a system comment "no OpenSpec change; archive skipped". The outcome stays `archivedAs: null`.
5. The VS-408 rebuild path is unchanged (backfill only, never a task skip).
