# Clean up and relocate scratch landing worktrees

Tracker change for [VS-383](weave://tickets/VS-383). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

`scratchLandWorktree` / `scratchBranchFrom` (`packages/core/src/tickets/archive-before-merge.ts`)
create a throwaway worktree of the project's primary clone under `mkdtempSync(join(tmpdir(),
'ac-land-'))` and dispose it in a `finally`. Yet `/tmp` held 31 `ac-land-*` trees (7.4G, on a
RAM-backed tmpfs) and `git worktree list` still registered 27 of them. Every one pre-dates the
release that shipped VS-363.

The cause is not a missing `finally`. Creation registers the worktree *before* the function returns
its `dispose` handle, so any failure in between leaks it and the caller's `finally` has nothing to
clean. Before VS-363 that gap was the ordinary path: `git worktree add --detach` succeeded, then
`git checkout -B <branch>` threw `'<branch>' is already used by worktree` whenever the requesting
worker's own worktree held the branch — exactly the tickets that land while their worker exists.
VS-363 removed that particular throw, but the gap remains: `mkdtempSync` runs before `git fetch` and
`git worktree add`, and if either fails the directory leaks too. Nothing sweeps stale scratch trees,
so once leaked they stay forever, on RAM.

## What changes

- **Scratch trees move off `/tmp`.** They are created under the workspace state directory
  (`<state>/scratch/<project-slug>/<label>-XXXXXX`, via `workspacePaths.state`), named per project and
  caller, never on a tmpfs.
- **Creation is leak-proof.** The scratch root is created first and any failure after that removes
  the directory it made; the worktree is registered only once the handle exists. `dispose` swallows
  and logs its own git/rm errors so it can never mask the landing outcome or leave the caller
  believing cleanup ran.
- **Stale scratch trees are swept.** At daemon start and on a supervisor period, every project
  clone's registered scratch worktrees — plus legacy `/tmp/ac-land-*` directories whose `.git` points
  into a known clone — are removed with `git worktree remove --force` + `prune` once older than a
  safe threshold and not in flight in this process. A worker's own worktree is never a candidate.
  What was removed is logged, with the reclaimed bytes.
- **Visibility.** A daemon route reports every workspace's scratch trees, their count and their size;
  `weave doctor` prints it, so a growing leak is visible instead of silent.

## Out of scope

Unrelated `git worktree` behaviour (the worktree provider, worktrunk), and any change to how a
landing rebases, archives or pushes. Migration of tickets already merged is the sweep's job, not a
data migration.
