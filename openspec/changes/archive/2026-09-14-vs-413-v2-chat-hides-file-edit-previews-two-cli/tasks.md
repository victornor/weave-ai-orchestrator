# Tasks — VS-413

## 1. Edit and write diffs open by default

- [x] 1.1 In `packages/ui/src/v2/ChatTrace.tsx`'s `ToolRow`, initialise the row's `open` state from
      `Boolean(block.editPayload)` (mirroring V1's `TranscriptLine`), so every edit/write call shows
      its `EditPayloadBody` diff on first render. A non-edit tool row still starts collapsed.
- [x] 1.2 Grow the edit body's scroll container from `max-h-40` to `max-h-96` so a typical edit is
      readable, while a long diff still scrolls inside the card.
- [x] 1.3 Confirm (and pin with a test) that a run of consecutive edit calls is not folded into a
      collapsed tool group: `groupConsecutiveTools` treats an `editPayload` block as its own row.

## 2. Tests

- [x] 2.1 An edit call shows its added and removed lines without any click.
- [x] 2.2 A write call shows its written file without any click.
- [x] 2.3 Three consecutive edit calls render three expanded diffs, not a collapsed `Edit ×3` group.
- [x] 2.4 Clicking an edit's header collapses it, and a later event leaves it collapsed.
- [x] 2.5 A `Bash ×N` group still starts collapsed (VS-370 unchanged).

## 3. Verify

- [x] 3.1 `pnpm lint` and `pnpm typecheck` green.
- [x] 3.2 Both suites run and pasted verbatim.
- [x] 3.3 Rendered check: the same chat turn with a multi-edit and a file write, V1 and V2, dark and
      light, against an isolated scratch daemon (or the throwaway Vite harness), saved outside the
      worktree.
