## Context

`projects.fetch` ran `git checkout <landing>` and `git merge --ff-only origin/<landing>` and mapped any failure to `diverged`. On a clone of an empty remote both fail (no `origin/<landing>`), so the project reads `diverged`; the `checkSync` path likewise failed `merge-base --is-ancestor`. The hourly reconcile sweep is the only thing that later fetches.

## Decisions

1. **Detect from the clone, after the fetch we already do.** `cloneIsEmpty` = `rev-parse --verify HEAD` fails AND `for-each-ref refs/remotes/origin` is empty. No extra network call (`ls-remote` was considered and rejected: the fetch just ran). Requiring both avoids misclassifying an unborn local branch when `origin` has other branches.
2. **A new enum value, not a nullable flag.** `diverged`/`behind`/`in_sync` are consumed from the stored column by the engine gate and the UI; a fourth value flows through the existing paths. Cost: SQLite cannot alter a CHECK, so migration 0067 rebuilds `projects` (with `-- ac:foreign_keys_off`, as 0050 did for `agents`), copying every column by name.
3. **On-demand fetch lives at worktree provisioning** (`withFreshEmptyClone` in the workers service, used by both `provisionTicketWorktree` and `ensureWorktree`), because that is the point where waiting for the sweep is known to hurt, and it is a single code path for spawn, repair and session pickup. One attempt, no loop; a fetch error is logged and the existing worktree error path applies. Cheap: one `git fetch` only for `empty` projects.
4. **Wording is a single constant** (`EMPTY_REMOTE_MESSAGE`) returned by `checkSync` so the UI and weaver-facing reads show the same text.

## Risks

- Known, out of scope: with OpenSpec enabled, `add` against an empty remote commits the scaffold locally; the push fails and the `HEAD~1` reset fails on a root commit, so that clone has a local commit and reads `diverged` once the remote gets a commit. This ticket's incident was the no-local-commit case. Surface it rather than fix it here.
- Migration rebuild of `projects`: guarded by the existing migration tests plus a CHECK test for the new value.
