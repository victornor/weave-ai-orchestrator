## Why

A project's primary clone is fetched and fast-forwarded to `origin/<landingBranch>` in several places
(the curation freshness gate, the hourly reconcile sweep, the overview's manual sync action, the
pre-archive fetch). When that fast-forward fails — most commonly because the remote branch was
force-pushed or rebased, not because anything real is sitting in the clone — today's code always
reports `diverged` and stops there. For a curation ticket that surfaces as `checkout_stale`: the ticket
is blocked with only "retry" (same branch, same problem) or "cancel" as options, and a human has to
notice and intervene by hand every single time. Captain has hit this recurring dead end enough times to
want it closed for good, not worked around per incident.

An audit of every place that writes into a primary clone directly (`packages/core/src/projects/index.ts`,
`packages/core/src/openspec/index.ts`) found the assumption "nothing but `fetch()` ever moves the primary
clone's branch" is almost true but not quite: `archiveAfterMerge`'s `local-branch`-delivery backfill path
(`commitArchive(..., push: false)`) commits the OpenSpec archive directly onto the clone's checked-out
branch and deliberately never pushes it, for projects that use direct-branch delivery. Any auto-recovery
has to tell that legitimate, real local commit apart from the disposable, superseded copy of a rewritten
remote history — and never discard the former.

## What Changes

- `projects.fetch()` (the function behind the curation gate, the hourly reconcile sweep, the overview's
  manual sync action, and the pre-archive fetch) gains a guarded self-heal: when `git merge --ff-only`
  fails, it checks whether the clone's branch tip is exactly where `fetch()` itself last left it (a new
  per-project watermark, `primaryCloneSyncedHead`, recorded on every successful fetch). If so, nothing
  but a rewritten remote could have produced the divergence, and it is safe to hard-reset the clone's
  branch to `origin/<landingBranch>` and continue. If the branch has moved since that watermark — the
  known `archiveAfterMerge` backfill path, or anything else that ever commits into the clone — the reset
  is refused and the divergence is reported exactly as it is today, distinguishing "real local commits
  present, needs a human" from a routine self-heal.
- The curation freshness gate's `checkout_stale` block now only fires for the guard-refused case. A
  clone that diverged purely from a rewritten remote self-heals invisibly and the curation turn runs
  normally — no ticket ever goes `blocked` for it.
- The overview's manual sync action, run against a diverged clone, now first attempts the same guarded
  recovery before reporting; it still reports and leaves the clone diverged when the guard refuses.
- The hourly reconcile sweep benefits automatically (it already calls `fetch()` for every ready
  project), closing the gap noted in the existing VS-131 comment about silently-logged fast-forward
  failures.
- Manual retry/cancel on a blocked curation ticket remains the fallback for whatever still can't
  self-heal (the guard-refused case, or a fetch failure such as being offline).

## Capabilities

### New Capabilities
- `project-overview/clone-recovery`: the guarded self-heal `projects.fetch()` performs on a diverged
  primary clone — the watermark that proves nothing but a rewritten remote could be responsible, the
  hard-reset when it is safe, and the distinct, undiscarded failure when it is not.

### Modified Capabilities
- `project-overview/sync-status`: the overview's manual sync action, run against a `diverged` clone, now
  attempts the guarded recovery from `clone-recovery` before falling back to reporting; the "never
  discard a commit" guarantee is unchanged, but "never resolve a diverged clone" is not — it is now
  qualified by the guard.
- `knowledge/curation-freshness`: "the primary clone has local commits that make
  `origin/<landingBranch>` unreachable by fast-forward" now blocks the ticket only when the guard in
  `clone-recovery` refuses to reset; a clone that diverged from a rewritten remote self-heals during the
  freshness check and the turn runs normally.

## Impact

- `packages/core/src/projects/index.ts` (`fetch()`) — the guarded self-heal and the new watermark.
- `packages/db` — a migration adding `projects.primary_clone_synced_head` (nullable).
- `packages/shared/src/types.ts` — `Project` gains the new field.
- `packages/core/src/runs/engine.ts` — no code change expected (the curation gate already reads
  `syncState` off the freshly-fetched row), but its blocked-ticket message changes in practice since it
  now only fires on a genuine anomaly.
- Callers unaffected in code, changed in practice: the hourly reconcile sweep
  (`packages/core/src/supervisor/index.ts`), the pre-archive fetch (`packages/core/src/openspec/index.ts`),
  the `POST /:id/fetch` route (`packages/server/src/routes/projects.ts`).
- Tests: `packages/core/src/projects/projects.test.ts` (real git repos, real force-push/amend
  simulation — see design.md for what is verified against real git vs. what stays out of scope), plus a
  new case for the guard-refused path; `packages/core/src/runs/engine.test.ts` for the curation gate's
  self-heal and still-blocked scenarios.
