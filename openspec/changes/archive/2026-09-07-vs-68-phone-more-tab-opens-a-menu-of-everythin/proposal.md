## Why

`packages/ui/src/app/nav.ts` gives the phone five tabs and makes More a plain link to
`/w/$ws/settings`. Everything else the app has — Runs, Usage, Knowledge and, since VS-58, the merge
queue page — is reachable on a phone only by typing the URL. Two tickets have already leaned on More
as the way out: VS-46 put the workspace list at the top of Settings *because* More opens it, and
VS-51 put the update entry there for the same reason. Settings has become the de facto "everything
else" page, which is the wrong shape: a section about configuration is carrying navigation.

The workspace owner's words: "The More button on mobile should not just take you to settings, it
should expose what is otherwise not available in the bottom bar (knowledge, settings etc.)."

## What Changes

- **More opens a menu instead of navigating.** The tab becomes a button that opens a bottom sheet
  (`MoreSheet`) listing every destination the five tabs leave out — Runs, Usage, Knowledge, Merge
  queue, Settings — each with its rail glyph and one line of what it holds, then the workspace list
  with its Needs-you counts and **New workspace**, and the daemon's update entry above them when
  there is one. The five tabs themselves are unchanged.
- **The bar's geometry is untouched.** The sheet is an overlay; More renders the same glyph, label
  and badge slot as a tab link, so the 390 px layout the geometry tests pin down is the same.
- **More says where you are.** It is marked active whenever the current page is one of the sheet's
  destinations, and it carries one badge: the daemon update when there is one, otherwise the
  Needs-you count of the *other* workspaces — a number the tabs, which address the active workspace
  only, cannot show anywhere else.
- **Nothing that VS-46 or VS-51 placed in Settings is removed.** The workspace list stays the first
  block of Settings and the update entry stays at its top: the sheet is a faster path to the same
  thing, not a replacement, and a link that lands on Settings must not be a dead end.
- **`Sheet` gains what a navigation menu needs**: a focus trap so Tab cannot walk out of an
  `aria-modal` sheet, initial focus on the panel when nothing asks for it, and an opt-in grab handle
  (`swipeToClose`) that dismisses the sheet when dragged down past `SWIPE_CLOSE_PX`. Escape and the
  tap-outside dismissal it already had are unchanged, and every other sheet is unaffected except
  that Tab now stays inside it.
- **`NavItem.kbd` becomes optional** and the glyph set gains `queue`: the merge queue is a
  destination with no rail number, because it is not a rail destination.

## Capabilities

### New Capabilities

(None. The phone's navigation is already specified; what changes is what the More tab does.)

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: the requirement "The phone keeps its tabs and offers
  the workspace list" becomes "The phone keeps its tabs and offers the rest behind More" — the bar
  still has exactly five tabs addressing the active workspace, but More opens a menu carrying every
  destination the bar leaves out plus the workspace list and the new-workspace action, is dismissible
  and keyboard-reachable, marks itself active for its destinations, and leaves the workspace list in
  Settings as well.
- `daemon-upgrade/upgrade-surfaces`: the phone requirement follows the navigation target it names —
  More now opens the menu rather than Settings, so the badge sits on the tab that opens the menu, and
  the menu carries the same entry the top of Settings does.
- `web-settings/settings-scopes`: the reachability requirement stops describing Settings as the
  destination of the More tab; it is reached from the More menu, and every area and section must
  still be reachable from there.

## Impact

- `packages/ui/src/app/nav.ts` — `MORE_ITEMS`, `MORE_TAB_KEY`, optional `kbd`, the `queue` glyph and
  the per-item `hint`.
- `packages/ui/src/app/MoreSheet.tsx` (new) — presentational, like `WorkspaceNav`.
- `packages/ui/src/app/BottomBar.tsx` — More renders as a button; the active rule and the badge slot.
- `packages/ui/src/app/AppShell.tsx` — the sheet's state, `otherWorkspacesNeed`, and the hotkey and
  palette loops now that `kbd` is optional.
- `packages/ui/src/app/NavGlyph.tsx`, `packages/ui/src/app/link.tsx` — the `queue` glyph, `onClick`.
- `packages/ui/src/components/Sheet.tsx` — focus trap, initial focus, `swipeToClose`, `SWIPE_CLOSE_PX`.
- `packages/ui/src/test/moreSheet.test.tsx` (new), `bottombar.test.tsx` — what the menu lists, where
  each item goes, dismissal, the focus trap, the active state and the badges.
- `docs/design/DESIGN-CONTRACT.md` §3 and the Updates block.

## Out of scope

- The five tabs themselves, and desktop navigation: the rail, its keyboard numbers and its update
  block are untouched.
- Making the Knowledge page's own tabs addressable. Knowledge is one destination; its documents,
  changelog, graph and specs are tabs inside it, and the menu says so in the item's hint rather than
  linking four places that have no URLs today.
- The workspace list at the top of Settings, which stays exactly as VS-46 built it.
