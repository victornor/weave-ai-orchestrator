## 1. Per-workspace Needs-you count on the workspace list

- [x] 1.1 Add `needsYou` to each item of `GET /api/workspaces` in `packages/server/src/routes/daemon.ts`, counting that workspace's decisions with `status = 'open'` and `owner = 'human'`; verify with a new case in the server route tests that a workspace with two open human-owned decisions, one answered and one agent-owned reports `2`, and an empty workspace reports `0`.
- [x] 1.2 Record the new field in `docs/API.md` under `GET /api/workspaces`; verify by reading back the entry, which must list `needsYou` alongside `id`, `name`, `ticketPrefix`, `root` and `projects`.
- [x] 1.3 Add `needsYou` to the workspace-list item type the web app reads (`packages/ui/src/api/types.ts`) and give `useWorkspaces()` a 60 s `refetchInterval`; verify `pnpm --filter @agent-conductor/ui typecheck` passes and the hook's options carry the interval.
- [x] 1.4 Invalidate `qk.workspaces()` from the four `decision.*` cases in `invalidateFor` (`packages/ui/src/api/events.ts`); verify with a unit test that a `decision.created` event invalidates both `qk.decisions(ws)` and `qk.workspaces()`.

## 2. The workspace group component

- [x] 2.1 Add `packages/ui/src/lib/wsExpansion.ts` reading and writing `conductor.ws.expanded` as a JSON array, `try`/`catch` on every access; verify with unit tests that an absent key reads as empty, an unparseable value reads as empty, a toggle round-trips, and a throwing `localStorage` does not propagate.
- [x] 2.2 Add `packages/ui/src/app/WorkspaceNav.tsx` — a presentational list taking workspaces, the active workspace key, the current path, the expanded set, a toggle callback, the active workspace's live needs count and its projects — rendering one group per workspace with a header (name, ticket prefix, count) and, when expanded, the eight `RAIL` links for that workspace; verify it compiles and is not yet wired into `AppShell`.
- [x] 2.3 Make the active workspace's group always expanded, non-collapsible, and marked active, with the shortcut hints and the Projects sub-list rendered only there; verify with component tests that the active group has no collapse control and that a non-active group's header carries `aria-expanded`.
- [x] 2.4 Render each header's Needs-you count — the live count for the active workspace, the listed `needsYou` for the others, nothing at zero; verify with component tests covering an active workspace whose live count differs from the listed one, a collapsed workspace with three waiting, and a workspace with none.

## 3. Wiring the rail

- [x] 3.1 Replace the rail's workspace dropdown in `packages/ui/src/app/AppShell.tsx` with `WorkspaceNav`, keeping Start Work above it, adding a permanent **New workspace** entry below it, and leaving the `⌘K` footer pinned while the workspace list scrolls; verify by running the app's existing shell tests and confirming no switcher control remains in the rendered rail.
- [x] 3.2 Update the `../api/hooks` mock in `packages/ui/src/test/appshell.test.tsx` for the shell's new hook usage; verify `pnpm --filter @agent-conductor/ui test` has that file green again.
- [x] 3.3 Confirm the section shortcuts and the palette still act on the active workspace and that "Switch workspace" is still offered; verify with a test that pressing the Board shortcut with a second workspace expanded navigates to the active workspace's board.
- [x] 3.4 Verify navigation between workspaces end to end: a test that following a non-active workspace's Board link produces the href `/w/<that workspace>/board`, and that `WorkspaceProvider` switching `ws` stops the old `EventStream` and starts one for the new workspace.

## 4. Expansion persistence in the shell

- [x] 4.1 Hold the expanded set in `AppShell` from `wsExpansion`, union the active workspace in, and write on every toggle; verify with a test that expanding two workspaces writes both keys to `localStorage` and that a remount restores them expanded.
- [x] 4.2 Handle a remembered workspace the daemon no longer reports, and a first visit with nothing remembered; verify with tests that an unknown stored key renders nothing and is left in storage, and that with no stored value only the active group is expanded.

## 5. Chat scroll position per workspace

- [x] 5.1 Add `packages/ui/src/lib/chatScroll.ts`, a module-scope per-workspace store of scroll offsets; verify with unit tests that two workspaces keep separate offsets and that clearing one leaves the other.
- [x] 5.2 Record the chat scroll offset on unmount and restore it on mount only when the stored position was not at the bottom; verify with a component test using faked geometry on `HTMLDivElement.prototype` (as `chat.test.tsx` already does) that a scrolled-up position is restored and a bottom position is left to `useStickToBottom`.
- [x] 5.3 Leave `Chat.tsx`'s composer untouched — draft persistence is VS-48's, and a second store would compete with it; verify that this change's diff touches no composer prop and that `packages/ui/src/test/chat.test.tsx` passes unchanged in that respect.

## 6. Phone

- [x] 6.1 Add a Workspaces block at the top of `packages/ui/src/routes/Settings.tsx` listing every workspace with its `needsYou` count and navigating on choice; verify with a component test that choosing another workspace navigates to it.
- [x] 6.2 Confirm the bottom bar is unchanged and nothing overlaps at 390 px; verify by running `packages/ui/src/test/bottombar.test.tsx` and checking the new block renders inside `PageBody` above the existing bar padding.

## 7. Documentation and checks

- [x] 7.1 Update `docs/design/DESIGN-CONTRACT.md` §3 so the desktop rail is described as the workspace list with nested sections, the removed dropdown is gone, and the Needs-you count per workspace is named; verify by reading back the section.
- [x] 7.2 Run `pnpm typecheck`, `pnpm lint` and `pnpm test` from the repo root and verify all three pass. **Result:** typecheck and lint exit 0; vitest reports 928 passed, 1 skipped, 0 failed. The runner still exits non-zero on two unhandled rejections in `packages/core` (`tickets.test.ts`, `projects.test.ts`) from a background clone that rejects after its test has finished. Pre-existing and not this change's: the branch touches no file under `packages/core`, and both files reproduce the error on their own.
