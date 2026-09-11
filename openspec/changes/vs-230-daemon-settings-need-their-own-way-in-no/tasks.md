## 1. The routing model

- [x] 1.1 Add `redirectForSettingsRoute(area, search)` and a per-route section resolver to `packages/ui/src/lib/settings.ts`, keeping `SETTINGS_SECTIONS`, `SETTINGS_AREAS` and `resolveSettingsLocation`'s behaviour intact; unit-test the decider's cases in `settingsScopes.test.tsx` (daemon-bound from workspace route with a section, with `?area=daemon` alone, with extra search params; workspace-bound from the daemon route with and without a remembered workspace; unknown sections stay; garbage stays).
- [x] 1.2 Split `SettingsRoute` in `packages/ui/src/routes/Settings.tsx` into `WorkspaceSettingsRoute` (workspace sections only, switcher gone, scope meta naming the workspace) and `DaemonSettingsRoute` (daemon sections only, no `useWs`, daemon-wide meta); section selection on both still writes `?section=` back with `replace: true` and preserves the rest of the search minus `area`. Verify in `settingsScopes.test.tsx` / `settings.test.tsx`.
- [x] 1.3 Register `/settings` as a root-level route in `packages/ui/src/router.tsx` wrapped in `AppShell` (no `WorkspaceProvider`), with `beforeLoad` redirects on both settings routes calling the decider; add `settings` to the workspace routes' sibling list assertion and the global-page list in `appshell.test.tsx`/`router.test.tsx`.

## 2. The daemon page without a workspace

- [x] 2.1 Add `useModelsOptional()` to `packages/ui/src/api/hooks.ts` (same query, `useHookWs`-keyed, disabled when empty) and use it in `DaemonModelsSection`; adjust the inherit hint to the workspace-agnostic copy and the intro paragraph's "This workspace → Models" wording. Verify `models.test.tsx`/`settings.test.tsx` still green and the daemon-page render works with no provider in `settingsScopes.test.tsx`.
- [x] 2.2 Make `DeviceSection`'s push controls address the remembered workspace (`useHookWs()` falling back to `getWorkspaceId()`), with the no-workspace explanation in the push block; `lib/push.ts` unchanged. Verify in `settingsScopes.test.tsx` (device section renders and toggles its browser-local controls on the daemon page).

## 3. Navigation and announcement retargeting

- [x] 3.1 Add the Settings entry to `GLOBAL_NAV` in `packages/ui/src/app/nav.ts` (→ `/settings`, daemon hint) and drop the daemon mention from `MORE_ITEMS`' Settings hint; assert the entry in `moreSheet.test.tsx` and the rail's global block in `appshell.test.tsx`/`workspacenav.test.tsx`.
- [x] 3.2 Retarget the update announcement links — `AppShell`'s rail block and `MoreSheet`'s update entry — to `/settings?section=updates`, and make the phone update banner on the workspace settings page navigate to `/settings?section=updates` while staying hidden when Updates is already shown on the daemon page. Verify `appshell.test.tsx`, `moreSheet.test.tsx`, `updates.test.tsx`.
- [x] 3.3 Re-point the switch-referencing copy ("Set in This daemon → Models" in both places, the daemon models intro). Verify by grep that no UI string references the removed area switcher labels as navigation.

## 4. Tests and checks

- [x] 4.1 Rewrite the pinned behaviours: `settingsScopes.test.tsx` (two destinations, no radios, metas, deep links per destination, redirect decider, device placement), `updates.test.tsx` (URL addressing on the daemon page, phone banner navigation), `moreSheet.test.tsx`, `appshell.test.tsx`, `router.test.tsx`. Verify with `pnpm --filter @agent-conductor/ui exec vitest run`.
- [x] 4.2 Full gates green: `pnpm lint && pnpm typecheck && pnpm test`, reporting both suite blocks verbatim with their real totals.
