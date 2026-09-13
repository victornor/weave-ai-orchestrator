## 1. Settings shell: scope row, section row, applies-to line

- [x] 1.1 Add `packages/ui/src/v2/settings/sections.ts`: the two ordered section lists (daemon:
  `updates, models, security, host-tools, dictation, device`; workspace: `weaver, models, projects,
  knowledge, approvals, channels, presentation`), each entry's label and body key; `firstSectionOf`,
  `sectionFor(scope, key)` and `scopeFromSearch(search)`. Verify with a unit test that every listed
  section resolves to a body key and an unknown `?section=` falls back to the scope's first.
- [x] 1.2 Add `packages/ui/src/v2/settings/V2Settings.tsx`: read `?scope=`/`?section=` (search
  passthrough), render the `V2Page` frame with a scope row (`This daemon` + each `useWorkspaces()`
  entry) and the section row for the active scope; navigating with `useGo` writes both. Changing
  scope resets the section to that scope's first. Verify with a test that switching scope changes the
  section row and the body, and that the URL carries both names.
- [x] 1.3 Render the applies-to line: daemon "This daemon — applies to every workspace on this
  machine."; workspace "{Name} — applies to this workspace only."; the daemon has no applies-to
  control. Verify with a test for both strings.
- [x] 1.4 Wrap the workspace-scoped body in `<WorkspaceProvider ws={selectedWs} remember={false}
  live={false}>` so context-scoped hooks address the selected workspace; assert in a test that
  selecting a workspace scope does not open an `EventStream` and does not call `setWorkspaceId`.
- [x] 1.5 Swap `V2SettingsPage` in `packages/ui/src/v2/pages.tsx` to render `V2Settings`; if the V2
  route needs a search passthrough for `?scope=`/`?section=`, add it in `router.tsx` without
  touching V1's routes. Verify `v2router.test.ts` still passes.

## 2. Daemon sections

- [x] 2.1 **Updates**: reuse V1's `UpdatesSection` behaviour (`useDaemonUpdate`, `useDaemonUpgrade`,
  `useRefreshDaemonUpdate`, `useRequestUpgrade`, `useCancelUpgrade`, `lib/upgrade.ts`) restyled to
  V2: the key-value table (version, commit, release, source/target/checked), Check again / Upgrade,
  and the last upgrade's log in a scrolling block. Verify with a test that the rows render and
  Check again fires `useRefreshDaemonUpdate`.
- [x] 2.2 **Models (daemon scope)**: render two agent cards (Weaver, Workers) from the Decision-3
  `ModelCard`, editing the daemon overlay via `useDaemonModels`/`useSetDaemonModels`; an empty
  overlay field shows the built-in default recessed with a Reset that clears it. Verify with a test
  that editing a field PUTs the overlay and Reset sends `null`.
- [x] 2.3 **Worker options (daemon scope)**: collapsed rows expanding to the multiline "When to use"
  editor (character count, the weaver-reads line) and the runtime/model/thinking row; `+ Add option`
  appends a blank row; Remove deletes. Validate against `WorkerModelOptionSchema` /
  `WorkerOptionsArraySchema` as V1 does. Verify with tests for expand/edit, add and remove.
- [x] 2.4 **Security & devices**: reuse V1's `SecuritySection` (`useMe`, `useAuthSessions`,
  password, TOTP setup, device revoke, sign-out-all) restyled to V2. Verify with a render test.
- [x] 2.5 **Host tools**: reuse V1's `HostToolsSection` (`useDaemonHostTools`, `useSetDaemonHostTools`)
  restyled. Verify with a test that the tool rows render and saving paths fires the mutation.
- [x] 2.6 **Dictation**: reuse V1's `DictationSection` (`useTranscription`, `useSetTranscription`)
  restyled, including the Voxtype-not-installed message. Verify with a render test.
- [x] 2.7 **This device**: reuse V1's `DeviceSection` behaviour for silent turns, dictation
  diagnostics and notification categories (destination `conductor.notifs`, `lib/push.ts`),
  restyled; omit the dark/light/system buttons and point at the V2 rail footer switch (Open Question
  2). Verify with a test for the notification toggles persisting.

## 3. Workspace sections

- [x] 3.1 **Weaver**: a read-only description list — "Reviews every approval before you see it" /
  "Marks each one unseen, looked or concerns."; "Let me override a held card" / "Recorded on the
  ticket with your reason."; "Model tier default for new tickets" with a static `.v2-tag` "standard".
  No `role="switch"` and no `<select>` in this section. Verify with a test that these render as
  text/tag and the section contains no switch or select.
- [x] 3.2 **Projects**: V1's `ProjectsSection` behaviour restyled — add form, each row expanding to
  landing branch, setup command, max workers and the per-project delivery/setup policies (proposal
  approval, task approval, merge method, delivery mode, archive commit, require CI, auto-merge
  default, merge concurrency), plus Remove and Move. Verify with tests for the expansion and one
  policy write.
- [x] 3.3 **Knowledge**: editable `defaults.knowledgeBudgetTokens` (workspace, shared, decisions,
  project, document) and `defaults.bootstrapBudgetTokens` via `usePatchConfig`, plus the read-only
  Curation rows (`schedule` → "weekly · Sunday 03:00", `over budget` → "curate early"). Verify with a
  test that a budget save PATCHes config and the curation rows are not controls.
- [x] 3.4 **Approvals**: the YOLO switch plus editors for the workspace defaults
  (`defaults.proposalApproval`, `defaults.hireApproval`, `defaults.deliveryMode`,
  `defaults.autoMerge`) via `usePatchConfig`. Verify with a test for the YOLO toggle and one default
  write.
- [x] 3.5 **Channels**: V1's Telegram section (`useTelegramTokenStatus`, `useSetTelegramToken`,
  `useClearTelegramToken`, `useTelegramPending`, `useApproveTelegramUser`,
  `useDisableTelegramAllowAll`) restyled — token, allowlist rule badge and open-access off, pending
  approvals. Verify with a render test.
- [x] 3.6 **Presentation**: V1's `PresentationSection` (`usePresentation`, `usePresentationSurfaces`,
  `usePutPresentation`) restyled. Verify with a render test.
- [x] 3.7 Confirm every workspace section reads and writes through the selected workspace's
  `WorkspaceProvider`, and that no section is a dead tab (a test iterating `sections.ts` and
  asserting each renders a body).

## 4. Models redesign and workspace overrides

- [x] 4.1 Extract V1's model/effort rules into `packages/ui/src/v2/settings/model.ts`
  (`isCustomModel`, `effortsForModel`, `effortModeFor`, `settingAfterModelChange`) and unit-test
  them, so both scopes share one implementation.
- [x] 4.2 Add `ModelCard` (name, note, three-column runtime/model/thinking row, custom-model id
  field) used by both scopes; test that a model change re-renders the thinking control per the
  effort rule.
- [x] 4.3 Add `packages/ui/src/v2/settings/override.ts`: `baselineFor(agent|option, daemonModels)`,
  `overrideState(workspaceEffective, baseline)` → `'inherited' | 'overridden'`, and
  `diffLines(workspaceEffective, baseline)` producing strings like `thinking: high → max`. Unit-test
  all three, including no-overlay, equal, and multi-field-diff cases.
- [x] 4.4 Build the workspace Models section: two agent cards with the `inherited`/`overridden`
  `.v2-tag`, Override / Reset to daemon, an accent border when overridden and `.v2-recessed`
  controls when inherited, and a footer naming the diff via `diffLines`. Override/Reset write the
  workspace's effective models through `useSetModels` (Reset copies `baselineFor` into the field).
  Verify with tests: override sends the changed value, reset sends the baseline, and the footer
  text matches.
- [x] 4.5 Build the workspace worker-options list from the daemon's list, each with the same
  tag/Override/Reset and footer; editing one writes the workspace's full option list with the
  daemon's descriptions copied; header shows "N of M overridden". Verify with tests for both states.
- [x] 4.6 Build the overrides banner counting distinct overridden agents and options from
  `override.ts` (one source with the tags and footers). Verify the count matches the number of
  overridden tags rendered.
- [x] 4.7 Assert there is no Budget tab: a test that no scope's section list or body contains a
  `budget` section key.

## 5. Scheduled

- [x] 5.1 Add `packages/ui/src/v2/scheduled/V2Scheduled.tsx`: `useRoutinesMany(ids)` over
  `useWorkspaces()`, render the design's list (`Screens.dc.html:1124-1139`) with the status dot, the
  name, `scheduleLabel(r) · <workspace> · <project>` in the project's hue
  (`lib/projectColor.ts`; `--text-2` when no project), and the next-run/last-result stack. Verify
  with a test that rows from two workspaces render and a routine's project name carries its hue.
- [x] 5.2 Keep create: V1's add form (`useCreateRoutineAt`) restyled into the V2 list idiom.
- [x] 5.3 Keep edit, pause/resume and delete (`usePatchRoutineAt`, `useRemoveRoutineAt`) in the
  expanded row, plus the fire history (`useRoutineFires`) and 7d spend (`useRoutineUsageFor`).
  Verify with tests for each action's mutation body (`ws`, `id`, `patch`).
- [x] 5.4 Swap `V2ScheduledPage` in `packages/ui/src/v2/pages.tsx` to render `V2Scheduled`. Verify
  `v2router.test.ts` still passes.

## 6. Verification

- [x] 6.1 The acceptance tests exist and pass: scope switching; override and reset with the
  difference footer; banner count agrees with the tags; every kept section renders; Scheduled CRUD;
  no Budget tab; read-only items are not controls.
- [x] 6.2 `pnpm lint` and `pnpm typecheck` are green.
- [x] 6.3 `pnpm test` (core/server) and `pnpm --filter @weave-ai/ui exec vitest run` (UI) both pass;
  paste both suite blocks verbatim in the delivery report.
- [x] 6.4 Confirm frontend-only: no daemon, HTTP route, config schema, migration or CLI change in
  the diff; V1's existing UI tests pass unchanged.
- [x] 6.5 `openspec validate vs-348-weave-v2-ui-settings-daemon-and-workspac --json --strict` is
  clean.

## 7. Plan-review additions (2026-09-13)

- [x] 7.1 Add a workspace **General** section to `sections.ts` and the body: V1's Name / Ticket-prefix editor restyled, reading and writing through `useWorkspaceSummary`/`usePatchConfig`. Render test added.
- [x] 7.2 Add a workspace **Plugins** section to `sections.ts` and the body: V1's read-only loaded-plugins list restyled. Render test added.
- [x] 7.3 Add both sections to the every-section-renders test (`v2settings.test.tsx`).
- [x] 7.4 Drop the theme buttons from This device: `DeviceSection` gains `themeControl` (default `'full'`, V1 unchanged) and V2 renders `'note'`, pointing at the V2 rail switch.
- [x] 7.5 Keep the value-based override logic isolated in `v2/settings/override.ts` for the follow-up inherit ticket, and shorten the override banner to one line.
- [x] 7.6 Update the `web-v2/settings` spec and the design/proposal Open Questions to record the resolved decisions.
- [x] 7.7 Show an unset approval/delivery default as the resolved built-in default labelled "(default)", not as an explicit pick; render test added.
