## Context

See `proposal.md` — Why for the motivation. Two current-state facts shape the approach:

- `landedWorkTest` (`packages/core/src/worktrees/landed.ts`) reads `git status --porcelain` and
  returns `landed: false` on *any* line before it ever looks at whether the branch landed. The
  worktree providers (`git.ts`, `worktrunk.ts`) refuse `git worktree remove` on a dirty tree unless
  passed `force`.
- `retireIfLanded` (`packages/core/src/workers/index.ts`) only treats a worker as merged when
  `ticket_work_products.state = 'merged'`. `reconcilePullRequests` refreshes PR state only for
  `in_review` tickets (`supervisor/index.ts`), so a terminal ticket's stale `open` record never
  updates.
- The UI's `TeamRoute` calls `useWorkers({})`, whose only filter is `status != 'retired'`, and the
  worker list already carries `errorText`; `cancel` already writes its reason there.

## Goals / Non-Goals

**Goals:**

- A finished worker with only untracked leftovers retires on the normal sweep, with the leftovers
  preserved in the archive, so the workspace's stuck worker set clears itself with no manual edit.
- A finished worker whose committed work genuinely did not land is kept and *visible* with a reason.
- The section that shows roles and their live instances is named Roles at a stable address.

**Non-Goals:**

- No new discard-approval flow; a kept worktree stays discardable through the existing
  `POST /workers/:id/purge` with `force: true`.
- No database migration.
- Not fixing the pre-existing `landedWorkTest` call in `packages/server/src/routes/worktrees.ts`
  that passes `prMerged`/`deliveryMode` (`as never`), which already ignores both flags.
- Not rewriting historical OpenSpec archives or ADRs that say "Team".

## Decisions

### 1. The landed test classifies dirty files instead of treating them alike

`landedWorkTest` SHALL run `git status --porcelain -z --untracked-files=all` (NUL-separated, every
untracked file listed individually), split entries into untracked (`??`) and tracked changes, and
return `untrackedFiles: string[]` on the verdict alongside the existing fields. Untracked-only
dirt no longer short-circuits to "not landed"; the committed-work checks run against the effective
landing branch as usual. Tracked changes still short-circuit to not-landed, with the existing
"uncommitted change(s)" wording so existing callers and tests keep their meaning.

- *Alternative:* keep the blanket refusal and add a separate "sweep" that force-removes old dirty
  worktrees. Rejected: it discards without a landed proof and cannot distinguish leftovers from
  abandoned work.
- *Alternative:* `git clean` the untracked files. Rejected: it deletes them.
- `-z --untracked-files=all` is chosen over plain porcelain because it gives exact relative paths,
  one per file, without git's C-quoting — so the archive copy cannot miss a file whose name contains
  a space or non-ASCII character.

### 2. Untracked files are copied to the archive before the worktree is removed

`retireIfLanded`, on a landed verdict with untracked files: copies each file from
`<worktree>/<rel>` to `<ctx.paths.archive>/<workerId>/untracked/<rel>` (creating directories),
then removes the worktree with `force: true`, then archives the worker home. The home archive
merges into `archive/<workerId>` when that directory already exists (it does, because the untracked
copy created it), using copy-then-remove; when no untracked copy was made, the existing
rename fast path is kept.

- Ordering is deliberate: copying the untracked files first means a failed worktree removal leaves
  the files preserved and the home untouched, and the next supervisor tick retries the whole
  retirement idempotently. Archiving the home first would leave `homePath` pointing at a moved
  directory if removal then failed.
- `force: true` is passed only when untracked files were present. The verdict has already proved
  there are no modified or staged tracked files, so force can only discard the files that were just
  copied. As a belt-and-braces guard, `retireIfLanded` re-reads the porcelain classification
  immediately before removal and aborts the retirement (recording the reason) if a tracked change
  appeared since the verdict.
- The worker archive is pruned after `workerArchiveDays` (default 30, `supervisor/index.ts`), so
  archived leftovers are kept for a month, not forever. Retirement therefore writes a rescue trail:
  a system comment on the ticket listing the archived relative paths (first 50, then `and N more`),
  and the same (capped) list in the `worker.retire` activity payload. A human can recover a real
  file before it ages out.

### 3. Forge evidence is refreshed for terminal tickets inside `retireIfLanded`

When the worker's ticket is `done` or `cancelled` and its `pull_request` work product is not
recorded as merged, `retireIfLanded` asks the `github` forge for `prState` at the project's clone
path, updates the work product's state on a merged answer, and passes `mergedPr: true` into the
landed test. A forge error or an unresolvable PR is swallowed: the stored record decides.

Because `retireFinished` runs on every 15 s supervisor tick, the refresh is throttled to at most
once per worker per hour. The last-checked instant is kept in an in-memory map keyed by worker id
(and the worktree's `lastVerifiedAt` is stamped on each refusal, so the window survives the useful
case without a migration); between checks the stored record is used. Without this, a worker whose
PR is genuinely still open — a cancelled ticket's, say — would cost about 240 `gh pr view` calls an
hour indefinitely.

- *Alternative:* extend `reconcilePullRequests` to include terminal tickets. Rejected: that runs
  every supervisor tick and would `gh pr view` every historical terminal PR in the workspace,
  whereas this path only runs for the one worker being retired and only while its record is stale.
- *Alternative:* no throttle, rely on `gh`'s own caching. Rejected: `gh` has none here.

### 4. The kept reason reuses `agents.error_text`

`retireIfLanded`, when it refuses, writes `errorText = verdict.reason` on the worker (the `cancel`
path already stores its reason there). The Roles page reads `status === 'done' && errorText` as
the finished-work-kept set and shows that text.

- *Alternative:* a new `agents.kept_reason` column — rejected as a migration for one string when
  the row already carries a reason field that is shown nowhere critical for a `done` worker.
- *Alternative:* join the latest non-removed worktree into `GET /workers` and re-derive the reason
  — rejected as more API surface and a per-list read of git-evidence JSON for the same string.
- `relaunch` already clears `errorText`, so a kept worker that is put back to work stops reading as
  finished.

### 5. Roles page filters client-side

The page keeps its single `useWorkers({})` call and splits the rows: live (`provisioning`,
`active`, `running`, `paused`, `error`) under each role, and kept `done` workers in the
"Finished, work kept (N)" group. The header counts the live set. No new endpoint or query key.

- *Alternative:* fetch `status=...` for live and a second query for kept. Rejected: the page already
  holds every non-retired row and the split is a one-line predicate.

### 6. Route rename keeps the old address working

`router.tsx` gains `/w/$ws/roles` (`RolesRoute`); `/w/$ws/team` becomes a route whose `beforeLoad`
throws a TanStack redirect to `/roles` with the same `ws` param. `nav.ts`, `GlobalMap.tsx`,
`lib/map/model.ts` and `WorkerPage.tsx` all point at `/roles` and read "Roles".

## Risks / Trade-offs

- **A tracked file changes between the verdict and removal** → re-read the porcelain classification
  right before removal; if a tracked change appeared, refuse and record the reason instead of
  forcing.
- **`gh pr view` is slow or rate-limited during a retirement sweep** → the call happens only for a
  terminal ticket whose record is not merged, and at most once per worker per hour; a failure falls
  back to the stored record, so the worst case is the current behaviour (kept), never a wrong
  retirement.
- **Archived leftovers are pruned after the retention window** → the ticket comment and the
  `worker.retire` activity payload name every archived path (capped), so a human can rescue a real
  file within the month instead of discovering it gone.
- **`errorText` is also a failure field** → the Roles page only treats a `done` worker's
  `errorText` as the kept reason; `relaunch` clears it; no other surface newly depends on it.
- **Bookmarks and muscle memory for `/team`** → the redirect preserves workspace and search.
- **A very large untracked directory** (e.g. an un-ignored `node_modules`) is copied into the
  archive → acceptable: preserving it is the explicit requirement, and gitignored paths never
  appear in porcelain.

## Migration Plan

Code-only daemon upgrade; no schema or data migration. On the first supervisor tick after upgrade,
the stuck workers clear themselves: the excess-review-leftover workers retire with their leftovers
archived; VS-147 retires after the forge refresh; any worker whose commits genuinely never landed
stays `done`, now carrying its reason, and appears in the Roles page's finished-kept group for a
human discard decision. Rollback is the previous release directory; the archive grew only by
copying files that already existed.

## Open Questions

None.
