## 1. Restore mobile workspace switching

- [x] 1.1 Add a **Workspaces** group to the phone More list in `packages/ui/src/v2/V2Shell.tsx`, above the current workspace's sections: one row per workspace from `useWorkspaces()`, carrying the workspace name and its open Needs-you count (from `useV2Counts`/`needsByWs`), marking the current workspace, and linking to `/w/<id>/needs`. Verify the shell still renders (`pnpm vitest run packages/ui/src/test/v2shell.test.tsx`).
- [x] 1.2 Extend `packages/ui/src/test/v2shell.test.tsx` to render the phone shell, open More, and assert the Workspaces group lists every workspace with its count, marks the current one, and that a non-current row links to `/w/<id>/needs`. Verify the test fails before the switcher exists and passes after.

## 2. Remove the V2 → V1 affordance

- [x] 2.1 Delete the `Open V1` row from `MoreList` in `packages/ui/src/v2/V2Shell.tsx`, and grep every V2 surface (`rg -i "open v1|back to v1|switch to v1" packages/ui/src/v2`, and a scan of `to="/"` links) for another V2→V1 control; remove any found. Verify the grep returns no V1 affordance in the V2 tree.
- [x] 2.2 Update the phone-More test in `packages/ui/src/test/v2shell.test.tsx` so it asserts no V1 row is present (replacing the current `getByText('Open V1')` assertion). Verify that test passes.

## 3. Verify and gather evidence

- [x] 3.1 Run `pnpm lint` and `pnpm typecheck`; verify both pass.
- [x] 3.2 Run `pnpm test`; paste both suite blocks (core/server and UI) verbatim with their totals.
- [x] 3.3 Capture the switcher open at phone width in light and dark, plus a desktop capture showing the V1 row gone, using the `docs/ui-screenshot-harness.md` recipe; keep the files outside the worktree, attach them to the ticket with `weave_ticket_attachment_put`, and confirm `git status --porcelain` in the worktree is empty.
- [x] 3.4 Open the PR naming the regression commits (VS-456 `02283f2c` and VS-457 `7fd2bc07`) and listing any other V2→V1 links found; confirm all acceptance criteria are covered.
