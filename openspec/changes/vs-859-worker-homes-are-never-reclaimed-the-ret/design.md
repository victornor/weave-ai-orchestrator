## Context

`retentionPass()` (`packages/core/src/supervisor/index.ts`) already prunes run logs and `archive/`
directories past their retention. `paths.workers` is used only to construct homes; nothing removes
one. Retirement (`WorkersService.retireIfLanded`) renames a landed worker's home into `archive/`, so
the ordinary retire path does not leave a home behind — but a worker that never retires does.

Measured on 2026-10-27 (read-only, details in the ticket's `notes` document):

| agent state | kind | dirs | size |
|---|---|---|---|
| `done` | worker | 60 | 66.9 GB |
| `active` / `running` | worker | 8 | 12.0 GB |
| `active` | planner | 3 | 1.2 GB |
| `retired` | planner | 8 | 69 MB |
| `retired` | worker | 1 | 1 MB |
| `done` / `active` | session | 2 | 2 MB |

The 60 `done` workers were cancelled or released at a terminal ticket while their worktree still
failed the landed test. All are clean today; 59 have a merged pull-request work product. The two
exceptions are VS-486 (cancelled, no PR) and VS-831 (delivered by force-push, no PR work product).

## Goals / Non-goals

**Goals:** stop `workers/` growing without bound; reclaim the existing backlog; never destroy
anything not provably landed; make every refusal visible.

**Non-goals:** changing retirement, the archive sweep, `bin/`/`obj/`/`node_modules` policy, or session
homes. Session homes are 2 MB total and hold no checkout; they are out of scope.

## Decisions

### One pass, in `retentionPass`

`retentionPass` becomes async and gains one step after the archive pruning. The step lives in
`WorkersService` (`reclaimFinishedHomes(actor, { dryRun, now? })`) because the provider, project and
worktree-row lookups already live there; `retentionPass` calls it and catches per-candidate failures
itself. This is the same pass, not a second scheduler, and it keeps the `supervisor:retention_at`
24-hour guard.

### Eligibility from agent state, not directory age

Candidates are directories under `paths.workers` joined to `agents` by directory name (the directory
name is the agent id; the survey found no orphans). Reclaim only when `kind IN ('worker','planner')`
and `status IN ('retired','done')` and
`COALESCE(retired_at, last_run_at, updated_at) < now - workerArchiveDays`.

- `retired_at` is the authority for a retired agent.
- A `done` worker has no `retired_at`; its own last turn (`last_run_at`) or the row's `updated_at` is
  its completion time. Directory mtime is never used: a home can be touched long after its worker
  finished, and a fresh mtime on an old agent would otherwise keep it forever (or, inverted, delete a
  worker that is merely quiet).
- A directory without an agent row is reported and kept. Deleting something the database cannot
  identify is not a decision this sweep may make.

### Landed proof: merged PR record, with `landedWorkTest` as the second path

Two independent proofs are accepted:

1. the worker's ticket has a `ticket_work_products` row with `type = 'pull_request'` and
   `state = 'merged'`; or
2. `landedWorkTest` returns landed (every commit reachable from a remote-tracking branch, or every
   commit has an equivalent patch in the landing branch).

The first exists because git ancestry cannot prove a landing in this workspace: squash merges produce
a patch-id no individual commit matches, VS-798 pruned 547 merged branches, and VS-776/VS-831 rewrote
history. The second still covers the cases git can answer (rebase merges, branches still on the
remote). An unreadable worktree or an undeterminable branch is a refusal, not a fallback.

### Clean means clean, including untracked files

The ticket's hard rule is `git status --porcelain` empty, so untracked files block too. The retirement
path archives untracked leftovers and proceeds; the sweep does not — it has no ticket to comment on
and 60 candidates where a leftover review screenshot is not worth a silent deletion. `worktreeChanges`
already returns tracked/untracked separately, which lets the finding say what the home holds.

### `deleteBranch: false` is the safety net

`provider.remove({ …, deleteBranch: false, force: false, configPath })`. The checkout and the
`.git/worktrees/<name>` metadata go; the branch ref and every commit stay in the project clone. That
makes a wrong judgement recoverable: `git checkout <branch>` restores the work. It also means the
sweep never needs `force`: a worktree the provider still considers dirty is refused.

`force: false` also keeps `wt remove` honest — it exits 0 when it refuses, and both providers report
the remaining path as an error, which this code treats as a refusal.

### Home deletion after the worktree, and only after

The home holds the worktree, so the provider must go first. After it succeeds the remaining home is
rendered files only (`AGENTS.md`, `brief.md`, `notes.md`, `.opencode/`, `.ac-render.json`), all
re-derivable from the ticket and role. If `rmSync` still fails, the worktrees row is already `removed`
and the next pass sees a home with no `work/` and deletes it. The ticket's "never half-remove" concern
is about a half state that can collide with a future spawn; a retired/done agent id is never reused,
so the retry is safe.

### Findings without ticket noise

Each refusal writes `log.warn({ workerId, reason, detail }, 'worker home not reclaimed')`, an
`activity` row of type `worker.home_retention_skipped`, and an entry in the return value. Successful
reclaims write `worker.home_reclaimed`. No ticket comment: the first live pass is expected to skip
VS-486, VS-831 and anything dirty, and 60 comments is not a report.

### Operator trigger

`POST /workers/prune-homes` with `{ dryRun }` (default `true`), route-table entry, and
`weave worker prune-homes [--dry-run]`, modelled on `weave project prune-branches`. It calls
`workers.reclaimFinishedHomes` directly, so there is one implementation. The response shape is
`{ dryRun, candidates: [...], reclaimed: [...], skipped: [{ workerId, name, status, reason, detail }], failed: [...] }`.

## Rejected alternatives

- **`status = 'retired'` only** (the ticket's wording): reclaims 70 MB of 78 GB. It would look like a
  fix and change nothing; 60 of 82 homes are `done`.
- **`git log origin/<landing>..HEAD` as the landed test** (the ticket's wording): non-empty on all 60
  for the reasons above, so nothing would be reclaimed.
- **`rm -rf` the directory**: leaves `.git/worktrees/<name>` metadata behind in the project clone and
  recreates the stale-worktree problem the ticket warns about.
- **A second retention scheduler**: two passes would race and double the provider calls.
- **Stripping `bin/`/`obj/` at turn end**: rejected by the decision on this ticket — a resumed worker
  that runs a no-build test would fail confusingly. It would be the cheaper steady-state lever
  (38 GB of the 78 GB is `bin/`), but it needs its own decision and risk analysis.

## Expected steady state

With the current churn (~60 finished workers over ~7 weeks, ~1.1 GB each) and a 30-day window, the
steady state is roughly **12 GB of live workers + ~33 GB of the last 30 days' finished homes ≈ 45 GB**,
down from 78 GB and no longer unbounded. The remaining bulk is regenerable build output; the ticket
records that number rather than promising a smaller one.

## Test strategy

- `supervisor.test.ts` (retention): a retired worker past the cutoff is reclaimed and its home gone; a
  `done` worker past the cutoff is reclaimed; a fresh one is kept; the existing archive tests are
  untouched and still pass.
- `workers.test.ts` (or a focused `prune-homes.test.ts`): each refusal — tracked change, untracked
  file, no landed proof, unreadable worktree, undeterminable branch, missing agent row — and that the
  sweep continues past a refusal. Cutoff cases: old directory + recent `last_run_at` is kept; fresh
  directory + old `last_run_at` is reclaimed; an `active`/`running` worker with an old directory is
  never touched.
- A real-git test: create a worktree, reclaim it through the registered provider, assert
  `git worktree list` no longer names it, the branch still resolves, and the home is gone.
- Dry run: no provider call, no deletion.
- Route/CLI: `POST /workers/prune-homes` defaults to dry run; `weave worker prune-homes --dry-run`
  deletes nothing and prints the skip list.

## First run and measurement

The change ships the sweep and the verb. After it is merged and the daemon has upgraded:

1. record `du -sh /home/v/agent-conductor/v-services/workers` and
   `weave worker prune-homes --dry-run` (candidate count and the skip list);
2. run `weave worker prune-homes` once;
3. record the after `du` and `git worktree list` in a sample project.

That run is an operator action against the live workspace; the ticket records its output. The apply
phase of this change performs only the read-only dry run against the live workspace, so the plan's
numbers are checked against reality before the code lands.
