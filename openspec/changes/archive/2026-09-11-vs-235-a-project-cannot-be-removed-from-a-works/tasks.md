## 1. Hooks

- [x] 1.1 Add `useRemoveProject` in `packages/ui/src/api/hooks.ts` (DELETE `/projects/:id`, invalidate `qk.projects` for the current workspace) and a `useMoveProject` that checks the destination's project list for the same slug, POSTs `/projects` on the destination workspace id with the copied config (`url`, `id`/slug, `name`, `defaultBranch`, `landingBranch`, `maxWorkers`, `setupCommand`, `policies`), then DELETEs the source, invalidating both workspaces' project queries. Do not wait for the dest clone job. Verify with the settings tests in 2.x that POST happens before DELETE, that a dest slug clash never writes, and that a dest POST failure never DELETEs.

## 2. Settings: remove and move

- [x] 2.1 On each active project row in `ProjectsSection` / `ProjectRow`, offer Remove opening a `Sheet` whose copy states archive-not-delete, tickets and knowledge retained, clone left on disk; Confirm calls `useRemoveProject`. Do not wrap the trigger in `Field`. Archived rows stay visible, inert (no edit/remove/move). Verify in `settings.test.tsx`: confirm copy, successful remove, archived row has no those controls.

- [x] 2.2 Count workers on the project whose status is not `retired` or `done` (same predicate as `projects.remove`). When that count is > 0, Remove and Move are unavailable and the reason names those workers. A DELETE 409 with that conflict is shown as the same reason, not a generic failure toast. Verify in `settings.test.tsx`.

- [x] 2.3 Offer Move when `useWorkspaces()` has at least one workspace other than the current. Sheet: destination picker, confirm copy naming the destination and stating history stays here, source clone left, dest clones afresh. Confirm runs `useMoveProject`. Hidden/unavailable with only one workspace. Verify in `settings.test.tsx`: picker, copy, successful move payload (POST dest then DELETE source), single-workspace case, dest slug clash before either write, dest-add failure leaves the source active, archive failure after dest add tells them dest already has it and to Remove here.

## 3. Sidebar

- [x] 3.1 In `WorkspaceNav` `ProjectsGroup`, skip projects whose `status === 'archived'` when rendering rows; keep passing the full id list (including archived) to `projectColorVar`. Verify in `workspacenav.test.tsx` that an archived project is not a row and that New project remains.

## 4. Tests and checks

- [x] 4.1 Extend the `api/hooks` mock in `settings.test.tsx` (and any other SettingsRoute mock that lists hooks) with `useRemoveProject`, `useMoveProject`, and `useWorkers` so existing settings tests keep rendering. Verify `pnpm --filter @agent-conductor/ui exec vitest run src/test/settings.test.tsx src/test/workspacenav.test.tsx`.

- [x] 4.2 Full gates green: `pnpm lint && pnpm typecheck && pnpm test`, reporting both suite blocks verbatim with their real totals.
