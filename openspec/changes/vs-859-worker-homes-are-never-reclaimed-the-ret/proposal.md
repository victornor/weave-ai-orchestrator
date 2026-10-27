## Why

`/home/v/agent-conductor/v-services/workers` holds 82 directories and ~78 GB. Nothing ever deletes
one: the retention pass prunes `archive/`, and every retire path either moves a home into `archive/`
or never runs at all. The bulk is not duplication — the worktrees share the project's object store
(280 KB of `.git` total) — it is checked-out working files, almost all of it gitignored build output.

A read-only survey on 2026-10-27 found the ticket's premise was wrong in one important way: only
**1 directory / 70 MB** belongs to a `retired` agent. **60 directories / 66.9 GB** belong to workers
in status `done` — cancelled, or released at a terminal ticket while their worktree still failed the
landed test. A sweep keyed on `status = 'retired'` would have reclaimed 70 MB of 78 GB and looked
like a fix.

The ticket's proposed landed test is also unusable here: `git log origin/<landing>..HEAD` is
non-empty on all 60, and `git cherry` cannot match a squashed commit, because VS-798 pruned 547 merged
branches and VS-776/VS-831 rewrote history. The durable proof that the work landed is the **merged
pull-request work product** in the database, not git ancestry.

## What Changes

- The existing `retentionPass` gains one more step — not a second, competing pass — that reclaims
  **finished worker homes** under `paths.workers`: agents of kind `worker` or `planner` in status
  `retired` or `done`, past `workerArchiveDays`, measured from `retired_at`, else the agent's own last
  turn/completion time. Never a directory mtime, never an `active`/`running` worker.
- A home is removed only when its worktree is **completely untouched** (`git status --porcelain`,
  including untracked files, prints nothing) and its work has **landed**: `landedWorkTest` says so, or
  the worker's ticket has a merged pull-request work product. Anything else is skipped and reported,
  and the rest of the sweep continues.
- Removal goes **through the worktree provider** (`git worktree remove` for `git`,
  `wt remove` for `worktrunk`) with `deleteBranch: false`, so the `.git/worktrees/<name>` metadata goes
  and the branch — and every commit in it — stays in the project clone. Only after the provider
  succeeds is the home directory deleted.
- Skips produce a finding — a `log.warn`, a `worker.home_retention_skipped` activity row, and an entry
  in the pass's return value — naming the worker, its status and what it holds. No ticket comments: a
  first pass legitimately skips 60 workers.
- `weave worker prune-homes [--dry-run] [--ignore-age]` (route `POST /workers/prune-homes`, service
  `workers.reclaimFinishedHomes`) runs the same function, so the operator can inspect the candidate
  and skip lists before anything is deleted. `--ignore-age` is an explicit one-off opt-in that lifts
  only the age window (the automatic pass always keeps it) and relaxes no safety gate.
- The `archive/` sweep, retirement, and `bin/`/`node_modules` handling are unchanged. Build output is
  **not** stripped at turn end: a resumed worker running a no-build test would fail confusingly, and
  `node_modules` is the expensive one to restore.

## Capabilities

### New Capabilities

- `worker-home-retention`: reclaiming a finished worker's home and worktree, safely, inside the daily
  retention pass, and the operator command that runs the same pass on demand.

### Modified Capabilities

## Impact

`packages/core/src/workers/index.ts` (the sweep and its findings), `packages/core/src/supervisor/index.ts`
(call it from `retentionPass`, which becomes async), `packages/core/src/api.ts` (service signature and
result shape), `packages/server/src/routes/workers.ts` + `routetable.ts`, `packages/cli/src/commands/worker.ts`,
and tests in `supervisor.test.ts`, `workers.test.ts` and the CLI/route suites. The live workspace's
first run is measured separately (`weave worker prune-homes` after the upgrade) and recorded on the
ticket.
