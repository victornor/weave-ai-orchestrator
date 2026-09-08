## 1. Data model

- [x] 1.1 Add `packages/db/src/migrations/0019_project_sync_state.sql`: `ALTER TABLE projects ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'in_sync' CHECK (sync_state IN ('in_sync', 'behind', 'diverged'))`; verify the migration applies cleanly against a fresh test DB (existing migration test harness).
- [x] 1.2 Add `PROJECT_SYNC_STATES = ['in_sync', 'behind', 'diverged'] as const` and `ProjectSyncState` to `packages/shared/src/enums.ts`, next to `PROJECT_STATUSES`; add `syncState: ProjectSyncState` to `Project` in `packages/shared/src/types.ts`. Verify `pnpm typecheck` surfaces every call site that constructs a `Project` without the new field.

## 2. Core: detection and persistence

- [x] 2.1 In `packages/core/src/projects/index.ts`, factor the shared `resolve landingBranchOf` + `git fetch origin` prefix used by both `fetch()` and the new `checkSync()` into a small local helper, per design.md's Trade-offs decision to keep them as two functions sharing a prefix rather than one parameterised function.
- [x] 2.2 Implement `checkSync(id): Promise<{ syncState: ProjectSyncState; behindBy: number | null }>`: fetches `origin/<landingBranchOf(project)>`, classifies via `git merge-base --is-ancestor` (never `checkout`/`merge`), computes `behindBy` via `git rev-list --count HEAD..origin/<landing>` when `behind`, persists `sync_state` on the project row, and emits `project.updated`. Verify with a unit test against a scratch local git remote (no network, no real credentials) covering `in_sync`, `behind` (with correct `behindBy`), and `diverged` (rewritten/force-pushed remote history), and that `HEAD`/working tree are unchanged in every case.
- [x] 2.3 Update `fetch()` to persist `sync_state` (`in_sync` on success, `diverged` when `merged.ok` is false) alongside its existing `lastFetchedAt` update, and emit `project.updated`. Verify with a unit test: a fast-forwardable clone ends `in_sync` and emits; a diverged clone ends `diverged`, still emits, and no commit is discarded from the clone.

## 3. Server: read-only sync route

- [x] 3.1 Add `GET /projects/:id/sync` in `packages/server/src/routes/projects.ts` calling `checkSync`, returning `{ syncState, behindBy }`. Document it in `docs/API.md` next to the existing `POST /projects/:id/fetch` line. Verify with a route test asserting the response shape and that it never calls the mutating `fetch()` path.

## 4. UI: data layer

- [x] 4.1 Add `qk.projectSync(ws, id)` to `packages/ui/src/api/keys.ts`, `useProjectSync(id)` (query, `GET /projects/:id/sync`, `staleTime: 60_000`) and `useProjectFetch(id)` (mutation, `POST /projects/:id/fetch`) to `packages/ui/src/api/hooks.ts`. `project.updated`'s existing handler in `packages/ui/src/api/events.ts:169-171` already invalidates `qk.projects(ws)`; extend it to also invalidate `qk.projectSync(ws, id)` for the affected project. Verify with a hooks/events unit test that a `project.updated` event invalidates both keys and that re-rendering within 60s does not refetch `useProjectSync`.

## 5. UI: project overview

- [x] 5.1 In `packages/ui/src/routes/project/ProjectOverview.tsx`'s "About this project" section, read `useProjectSync(project.id)` and render: nothing when `in_sync`; a `Badge tone="modified"` "N commits behind" plus a Sync button when `behind`; a `Badge tone="removed"` "diverged" with copy stating the clone holds history the remote no longer recognises and that a human must resolve it outside AgentConductor, no Sync button offered as a fix, when `diverged`. Verify with a component test for all three states.
- [x] 5.2 Wire the Sync button to `useProjectFetch`: on success, assert the badge clears without a page reload (query invalidation, no `location.reload`); on a diverged clone, the action is not offered as a fix (task 5.1 already excludes the button in that state, so this covers the `behind`-that-fails-mid-click edge only if one exists — otherwise fold into 5.1's test). Verify with a component test simulating a successful sync clearing the `behind` badge.

## 6. UI: sidebar marker

- [x] 6.1 In `packages/ui/src/app/WorkspaceNav.tsx`, replace the index-cycled `PROJECT_DOT` lookup (line ~31, used at line ~133) with a mapping from `project.syncState`: `diverged` → `--status-blocked`, `behind` → `--status-working`, `in_sync` → no dot rendered. Verify with a component test asserting all three renderings and that no extra network request is made to produce the marker (it reads `syncState` off the already-fetched project list).

## 7. Verification

- [x] 7.1 `pnpm typecheck`, `pnpm lint`, `pnpm test` all green.
- [x] 7.2 Manually exercise `behind` and `diverged` against a scratch local git remote (never this repository's own origin, per the rule against touching real credentials/remotes from inside a ticket); note the manual verification steps and outcome in the PR description.
