## 1. The area model

- [x] 1.1 Replace the `SECTIONS` tuple in `packages/ui/src/routes/Settings.tsx` with one table whose entries carry `{ key, label, area }`, add the two area descriptors with their labels, and export the helpers that resolve a section key to its area and an area to its first section; verify with unit assertions that every section key maps to exactly one area and that every area has at least one section.
- [x] 1.2 Resolve the selected area and section from the URL with `useSearch({ strict: false })`, in the order specified in the spec — a known `section` wins and brings its own area, otherwise a known `area` with its first section, otherwise the workspace area with its first section; verify with tests for a `?section=updates` link with no area, for a `?section=` and `?area=` that disagree, and for an unknown value falling back without an error.

## 2. The page

- [x] 2.1 Render the area switcher as a `Segmented` control in `PageHeader`'s `actions` slot and filter the `Tabs` strip to the selected area's sections; verify a test that the workspace area lists its sections and none of the daemon area's, and the same the other way round.
- [x] 2.2 Write the area and the section into the URL with `go(..., { replace: true })` on every area or section change, following `chooseFinished` in `BoardRoute`; verify a test that selecting a section navigates with both parameters and `replace: true`, and that switching area issues no mutation.
- [x] 2.3 File the existing sections into their areas — Workspace, Projects, Conductor, Channels, Presentation under the workspace area; Updates and Security & Devices under the daemon area — leaving each section component's contents unchanged; verify the existing knowledge-budget, YOLO and per-project tests still pass once they select the workspace area, and the Updates tests once they select the daemon area.

## 3. The device section

- [x] 3.1 Add the `device` section, labelled "This device", holding the theme picker moved out of `WorkspaceSection` and the existing notification toggles unchanged, under a caption saying the settings are stored in this browser only; verify a test that the section shows the theme control and the notification toggles and states the browser-only scope.
- [x] 3.2 Remove the theme `Field` from `WorkspaceSection`; verify a test that the workspace area no longer offers a theme control, and that the workspaces list is still shown in the workspace area.

## 4. Scope guarantees

- [x] 4.1 Add a test over `qk` in `packages/ui/src/api/keys.ts` asserting that the daemon-level keys (`daemonUpdate`, `daemonUpgrade`, `sessions`, `me`, `workspaces`, `runtimes`) contain no workspace segment while the workspace-level keys begin `['w', ws]`, so daemon state cannot acquire a per-workspace cache entry unnoticed; verify the test fails when a workspace segment is added to one of them.
- [x] 4.2 Add a test that both areas and every section within them are reachable from a single render — the phone path through the More tab — by switching area and opening each section in turn; verify each section's own heading appears.

## 5. Checks

- [x] 5.1 Update `packages/ui/src/test/settings.test.tsx` and `packages/ui/src/test/updates.test.tsx` for the area switch, keeping `updates.test.tsx`'s `openUpdates()` helper as the single place the daemon area is selected; verify `pnpm --filter @agent-conductor/ui exec vitest run` is green.
- [x] 5.2 Run `pnpm lint`, `pnpm typecheck` and the full `pnpm test`, and record any failure that is already present on `main` rather than caused by this change; verify all three report the same or better than the branch point.
