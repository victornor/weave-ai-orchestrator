## Why

Captain (2026-09-08): "what happens if a commit lands on a project repo outside of agent conductor?
Is there a way for us to detect this and provide a sync button on the project overview page (and
maybe show a small alert next to the project name in sidebar when out of sync is detected)?"

Today an outside commit is picked up, but only by the hourly `reconcilePass()`
(`packages/core/src/supervisor/index.ts:510-519`), which calls `projects.fetch()`
(`packages/core/src/projects/index.ts:307-325`) on every ready project. Two problems:

- A worktree cut in the up-to-an-hour window before the next sweep starts from a stale primary
  clone, and that surfaces later as a rebase or conflict at merge time.
- When the clone cannot be fast-forwarded — it has diverged from `origin/<landingBranch>` — `fetch()`
  logs a warning (`index.ts:322`) and returns normally. Nothing is persisted, nothing reaches
  captain, and every worktree cut from that clone keeps starting from the diverged base. This is the
  failure worth fixing more than the hour of lag.

## What Changes

- **Two distinct out-of-sync states, not one.** `behind`: the clone's landing branch can be
  fast-forwarded to `origin/<landingBranch>`. `diverged`: it cannot — the clone has commits the
  remote's tip does not recognise as an ancestor (most likely a force-push or history rewrite
  upstream). `fetch()` already tells these apart today (`merged.ok`); it just throws the answer away.
- `Project` gains a persisted `syncState: 'in_sync' | 'behind' | 'diverged'`. `fetch()` (the existing
  fetch-and-fast-forward, used by the hourly sweep, the OpenSpec archive-sync call and the new manual
  Sync action) now persists it and emits `project.updated` — today it emits nothing at all, which is
  why a diverged clone is invisible.
- A new read-only check, `GET /projects/:id/sync`, backs the project overview: it fetches
  `origin/<landingBranch>`'s objects and classifies the state locally (`git merge-base
  --is-ancestor`), but never checks out or merges — opening the overview page can never itself mutate
  the clone. It is called once per page visit via a 60s-`staleTime` query, not per render.
- The project overview shows the state (a quiet "N commits behind" badge, or an alarm-toned
  "diverged" badge with what happened and that a human must resolve it outside AgentConductor) and a
  Sync action that runs the existing fetch-and-fast-forward. On success the badge clears without a
  reload; on a diverged clone the action reports the failure plainly rather than silently no-op'ing.
- The sidebar's per-project dot (`packages/ui/src/app/WorkspaceNav.tsx:31,133`) is wired to
  `project.syncState` for the first time — today it cycles through five colours by list index,
  unrelated to any real project state. `diverged` gets the same alarm colour the rail already uses
  for `blocked`; `behind` gets the calmer colour already used for a routine in-progress state, so a
  clone catching up an hour's worth of an ordinary merge does not read as an alert; `in_sync` shows no
  dot at all.
- The existing hourly sweep is unchanged in cadence and keeps auto-healing `behind` clones (a
  fast-forward is safe and additive — this is not "resolving a divergence automatically", which stays
  out of scope and only ever applies to the `diverged` case). No new baseline network cost; see
  design.md for the exact accounting.

## Capabilities

### New Capabilities

- `project-overview/sync-status`: detecting whether a project's primary clone is behind or diverged
  from its remote, and the sync action that resolves the fast-forwardable case.

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: the per-project sidebar dot now reflects that project's
  real sync state instead of an index-cycled placeholder colour.

## Impact

- `packages/shared/src/types.ts`, `packages/shared/src/enums.ts` — `Project.syncState`,
  `PROJECT_SYNC_STATES`.
- `packages/db/src/migrations/` — one additive column, `sync_state`, defaulted to `in_sync`.
- `packages/core/src/projects/index.ts` — `fetch()` persists and emits; new `checkSync()`.
- `packages/server/src/routes/projects.ts`, `docs/API.md` — new `GET /projects/:id/sync`.
- `packages/ui/src/api/hooks.ts`, `packages/ui/src/api/keys.ts`, `packages/ui/src/api/events.ts` —
  `useProjectSync`, `useProjectFetch`, a new query key, and its SSE invalidation.
- `packages/ui/src/routes/project/ProjectOverview.tsx` — sync badge and Sync action.
- `packages/ui/src/app/WorkspaceNav.tsx` — the sidebar dot wired to real state.
- No change to worktree creation or to any worktree a worker already holds (explicitly out of
  scope); no change to `RECONCILE_EVERY_MS`.
