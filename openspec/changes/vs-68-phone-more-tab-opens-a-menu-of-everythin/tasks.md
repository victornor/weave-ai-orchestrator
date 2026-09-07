## 1. The destinations the bar leaves out

- [x] 1.1 `MORE_ITEMS` and `MORE_TAB_KEY` in `packages/ui/src/app/nav.ts`: Runs, Usage, Knowledge, Merge queue and Settings, each with the rail's glyph and a hint line; `kbd` optional, since the merge queue has no rail number; `AppShell`'s hotkey and palette loops follow.
- [x] 1.2 A `queue` glyph in `packages/ui/src/app/NavGlyph.tsx`, drawn in the same greyscale system as `chat`, `board` and `more`.
- [x] 1.3 A test pinning `MORE_ITEMS` against `RAIL` and `TABS`, so a rail destination added later cannot go missing from the menu.

## 2. The sheet

- [x] 2.1 `packages/ui/src/components/Sheet.tsx`: a focus trap over `Tab`/`Shift+Tab`, initial focus on the panel when nothing carries `data-autofocus`, and an opt-in `swipeToClose` grab handle that dismisses past `SWIPE_CLOSE_PX` and springs back below it.
- [x] 2.2 `packages/ui/src/app/MoreSheet.tsx`: the update entry, the destination list with `aria-current` on the page being shown, the workspace list with live and listed Needs-you counts, and New workspace — presentational, so it renders in a test from plain data.
- [x] 2.3 Every item closes the sheet as it acts; the content respects the safe area, and the sheet is an overlay so the bar's geometry is unchanged.

## 3. The tab

- [x] 3.1 `BottomBar` renders More as a button with `aria-haspopup="dialog"` and `aria-expanded`, sharing the tab's glyph, label and badge slot; `AppShell` owns the open state.
- [x] 3.2 More is active whenever the current page is one of `MORE_ITEMS`, and badges the daemon update or, failing that, what the other workspaces are waiting on (`otherWorkspacesNeed` in `AppShell`).

## 4. Cover it

- [x] 4.1 `packages/ui/src/test/moreSheet.test.tsx`: what the menu lists, each destination's href, the active marking, the workspace rows and their counts, New workspace, the update entry, dismissal (item, outside, Escape, swipe), and the focus trap.
- [x] 4.2 `packages/ui/src/test/bottombar.test.tsx`: More is a button that opens the menu, reports expanded, is active for a menu destination, and carries one badge with the update winning.
- [x] 4.3 `pnpm lint`, `pnpm typecheck` and `pnpm test` green, with the ui suite run separately as well.

## 5. The contract follows

- [x] 5.1 `docs/design/DESIGN-CONTRACT.md` §3: what More opens, how it is dismissed, why the geometry is unchanged, and that the workspace list stays in Settings; the merge-queue bullet and the Updates block name the menu as a surface.
- [x] 5.2 The spec deltas: the phone requirement in `workspace-navigation/sidebar-workspaces`, the phone announcement in `daemon-upgrade/upgrade-surfaces`, and the reachability wording in `web-settings/settings-scopes`.
