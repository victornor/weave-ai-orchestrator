## Why

The Team page lists about 22 finished workers that will never be retired: `landedWorkTest`
refuses on any `git status --porcelain` line, so untracked review leftovers (`screenshots/`,
`.scratch/`, a stray `harness.html`) keep a merged worker's worktree alive forever, and a stale
`open` pull-request record keeps a squash-merged one (VS-147) alive too. The supervisor retries
every tick and fails every time, and the page reads as if 21 Platform Engineers are still working.
The page is also misnamed: it groups hired roles and their live instances, so "Roles" is what it
shows.

## What Changes

- **Retirement stops keeping finished workers forever.** In `landedWorkTest` / `retireIfLanded`:
  untracked files alone no longer block retirement once the branch's committed work has landed;
  before the worktree is removed they are copied into the worker's archive directory
  (`<archive>/<workerId>/untracked/`, relative paths preserved). Modified or staged tracked files,
  and commits not contained in the effective landing branch, keep blocking as they do today.
- **Merged-PR evidence is refreshed from the forge.** When a terminal ticket's `pull_request` work
  product still says `open`, the daemon asks `forge.prState` before deciding and records a merged
  answer, so a squash-merged PR passes the existing patch-id path.
- **A cancelled ticket's unlanded work still needs a human.** Commits (or untracked material) that
  never landed stay not retired and are surfaced, not silently kept.
- **Team is renamed Roles.** Nav label and key, the route (`/w/$ws/roles`, with `/w/$ws/team`
  kept as a redirect), the page title, the in-app links (`GlobalMap`, the map model, the worker
  page's back link) and the component/tests.
- **The Roles page shows live instances.** Under each role only `provisioning`, `active`,
  `running`, `paused` and `error` workers are listed. A `done` worker whose work is kept (work has
  not landed, so it needs a discard decision) appears in a small "Finished, work kept (N)" group
  with the reason. Clean finished workers do not appear. The header meta counts live workers.

## Capabilities

### New Capabilities
- `workspace-navigation/roles-page`: the workspace section named Roles — its address, the `/team`
  redirect, the live-instance-only listing, the finished-work-kept group, and the header count.

### Modified Capabilities
- `worker-supervision/terminal-retirement`: retirement with untracked leftovers archived rather
  than deleted, blocked only by tracked changes and unlanded commits; forge refresh of a stale PR
  record for a terminal ticket; the kept-work reason recorded on the worker.
- `workspace-navigation/sidebar-workspaces`: the section list names Roles instead of Team.
- `workspace-navigation/global-map`: a role node opens the workspace's Roles page.
- `worker-concurrency/project-cap`: the page that must not offer a per-role max-workers editor is
  the Roles page.
- `project-naming`: the Roles page is among the surfaces that show a project's display label.

## Impact

- `packages/core/src/worktrees/landed.ts` — porcelain classification, `untrackedFiles` on the
  verdict.
- `packages/core/src/workers/index.ts` — `retireIfLanded` archives untracked files, force-removes
  the worktree, refreshes a stale PR record and records the kept reason.
- `packages/core/src/worktrees/git.ts` / `worktrunk.ts` — already accept `force`; no new option.
- `packages/ui/src/routes/Team.tsx` → `Roles.tsx`, `router.tsx`, `app/nav.ts`,
  `routes/WorkerPage.tsx`, `routes/GlobalMap.tsx`, `routes/Live.tsx`, `lib/map/model.ts`.
- `packages/ui/src/test/team.test.tsx` → `roles.test.tsx`, `workspacenav.test.tsx`.
- `packages/core/src/worktrees/worktrees.test.ts`, `packages/core/src/workers/workers.test.ts`,
  `packages/core/src/supervisor/supervisor.test.ts` — retirement cases.
- `docs/PLAN.md` — the view is named Roles where it describes current behaviour.
- No schema migration: the kept reason reuses the existing `agents.error_text` column.
- Non-goal: a new discard-approval flow. A kept worker remains discardable through the existing
  `POST /workers/:id/purge` (human `force`).
