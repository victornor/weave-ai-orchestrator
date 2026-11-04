## Why

`bootstrapOpenSpec` (`packages/core/src/projects/index.ts`) commits the `openspec init` scaffold in the primary clone and pushes it. When the push fails it undoes the commit with `git reset --mixed HEAD~1`. On a clone of an empty remote the commit is a root commit, `HEAD~1` does not exist, the reset exits 128 and its result is never checked. The clone keeps an unpushed root commit while the log claims the files were "left uncommitted". When the remote later gets its first commit the histories are unrelated, `primaryCloneSyncedHead` is null so the VS-673 self-heal refuses to act, and the project reads `diverged` permanently.

## What Changes

- After a failed push, undo the adoption commit in a way that works for a root commit: `git update-ref -d HEAD` when the commit has no parent (the branch becomes unborn again, files stay staged), `git reset --mixed HEAD~1` otherwise.
- Check the undo's exit status. Log the "left uncommitted" warning only when the undo succeeded; otherwise log an error that says the clone is ahead of origin.
- Test with a bare remote whose `pre-receive` hook rejects the push, for both an empty remote and a remote that already has commits.

Out of scope: project registration and the sync-state work in VS-964.

## Capabilities

### New Capabilities
- `openspec-adoption`: how project setup commits and pushes the OpenSpec scaffold and what it guarantees about the primary clone when the push fails.

## Impact

`packages/core/src/projects/index.ts`, `packages/core/src/projects/projects.test.ts`.
