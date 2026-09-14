## Context

VS-389 (`archiveAfterMerge` → `ac/archive-<change>` pull request → `landArchiveBackfill`) lands an
archive through `attemptArchiveThenMerge` (`packages/core/src/tickets/archive-before-merge.ts`). For
an archive branch the change is already under `openspec/changes/archive/`, so that function skips
re-archiving and, when the branch has fallen behind, rebases it onto `origin/<landing>` and
force-pushes (`archive-before-merge.ts:161-190`). A rebase conflict returns
`{ kind: 'conflict' }`, and the reconciliation sweep retries it on every pass.

That retry can never succeed: the archive commit rewrites `openspec/specs/**/spec.md` against the
specs as they stood when the branch was cut. If main changed the same file afterwards (VS-385 added
`openspec/specs/plugins/web-pages/spec.md` after VS-334's branch was cut), replaying the archive
commit conflicts on that file, and every subsequent retry replays the same conflict. #313 is stuck
exactly this way.

The archive branch holds everything needed to rebuild: its parent is the landing tip the change was
merged onto, and that parent still contains `openspec/changes/<change>` — the change's deltas before
archiving. Neither the ticket's delivery record nor the merge commit is needed.

## Goals / Non-Goals

**Goals:**

- A stale `ac/archive-<change>` branch whose rebase conflicts is rebuilt from the current landing
  tip, force-pushed, and merged by the existing checks-and-merge path.
- A rebuild `openspec` refuses is surfaced with its reason, recorded once, and wakes the weaver
  once — no loop.
- Behavior for a normal ticket landing (including a genuine worker conflict) is unchanged.

**Non-Goals:**

- Changing how a ticket's own branch is landed, or resolving a normal ticket's real rebase conflict
  on the worker's behalf.
- Changing the sweep, the card model, the landing lock, the check-waiting rules, or the delivery
  record.
- Completing the live #313 merge from inside this ticket: the pull request is merged by the running
  daemon, never by a worker, so the real landing follows a daemon upgrade and captain's approval of
  the card.

## Decisions

### 1. The rebuild is opt-in per caller, never inferred from the branch's shape

`attemptArchiveThenMerge` gains an `opts.rebuildArchiveOnConflict?: boolean` (default false).
Only `landArchiveBackfill` passes `true` — it is the only caller landing a sweep-owned archive
branch. `mergeDone` (the ticket's own branch) leaves it false, so its conflict behavior is byte-for-
byte what it is today.

Alternatives considered: detect "the change is already archived on this branch" and rebuild on that
shape. Rejected: a ticket branch can also carry an already-archived change (a retry after
`checks_pending` did exactly that), and a rebuild resets the branch to the landing tip — which would
silently discard any other commits the ticket branch carries. A caller flag keeps that destructive
operation out of every path but the archive-backfill one.

### 2. The rebuild sources the change directory from the branch's pre-archive parent

On conflict, with the flag set: record `parent = git merge-base HEAD origin/<landing>` (HEAD is
detached at `origin/<branch>` and the aborted rebase left it there), `git reset --hard
origin/<landing>`, and if `openspec/changes/<change>` is not present at the tip, `git checkout
<parent> -- openspec/changes/<change>`. Then `archiveOnBranch(...)` runs `openspec archive` against
the current specs and commits. The push reuses the existing
`--force-with-lease origin HEAD:refs/heads/<branch>` step.

The change directory is normally still on the landing tip (the change was left behind there), so the
restore is a fallback; sourcing it from the parent keeps the rebuild correct if the tip no longer
carries it. `merge-base` is the pre-archive parent for the base+archive-commit shape both
`archiveAfterMerge` and any prior rebuild produce.

### 3. A refused rebuild is its own outcome

`ArchiveThenMergeOutcome` gains `{ kind: 'rebuild_failed'; detail: string }`. The rebuild catches
`archiveOnBranch`'s `OcError` (`openspec_archive_blocked` carries openspec's message and fix) into
`detail`, without pushing anything. `landArchiveBackfill` maps it to `fail(outcome.detail)`, so
`recordArchiveLandingFailure` records openspec's own reason and its `(reason, prUrl)` dedupe wakes
the weaver at most once — the same machinery a rebase conflict already flows through, so no new
bounded-retry counter is needed and no distinct loop can form. `mergeDone` maps it to
`failLanding('rebuilding the archive failed: ' + detail)` for exhaustiveness; it is unreachable
there because the flag is off.

### 4. The rebuild happens before the archive-skip decision, not instead of it

The existing `archiveName` block (skip re-archiving when the change is already under
`changes/archive/`) runs after the rebase. The rebuild must run in the conflict arm and mark that it
already archived, so that block is skipped for the rebuild and unchanged for every other path — the
`checks_pending` retry test still expects `archivedAs` to be filled from `archiveAfterMerge`'s own
result.

## Risks / Trade-offs

- **A rebuild force-pushes the sweep-owned branch.** → `ac/archive-*` is daemon-owned and never
  human-edited; `--force-with-lease` still guards a concurrent update, exactly as the existing
  rebase push does.
- **`merge-base` is the wrong parent for an unusual branch shape.** → If the restored change
  directory is still missing, the rebuild fails cleanly with `openspec`'s reason rather than
  pushing a partial tree; the branch is left untouched for the sweep to retry or a human to inspect.
- **A rebuild failure is retried every sweep.** → It is retried, but silently: the record and wake
  are deduped per `(reason, prUrl)`, which is the "does not loop" the acceptance asks for. A reason
  that changes (e.g. an `openspec` upgrade) comments and wakes again, which is wanted.
- **Rollback.** → The previous release ignores the new outcome kind's branch and simply retries the
  rebase as before; no state is corrupted. The branch is only ever moved on a successful rebuild.

## Migration Plan

No schema migration. Ships with a daemon upgrade; the reconciliation sweep then rebuilds and
force-pushes #313's branch on its next approved-card pass, and captain merges the card as usual.

## Open Questions

None. The one judgement is Decision 1 (opt-in flag rather than shape detection), because a rebuild
resets the branch.
