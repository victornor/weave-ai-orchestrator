# Tasks — Work board columns fill the screen width

## 1. Column width

- [x] 1.1 In `packages/ui/src/v2/work/Work.tsx`, change each `<section data-v2-column>`'s inline style from `flex: '0 0 ' + V2_KANBAN_COLUMN_WIDTH + 'px'` / `minWidth: V2_KANBAN_COLUMN_WIDTH` to `flex: '1 1 0'` with the same 236px `minWidth`, and re-document `V2_KANBAN_COLUMN_WIDTH` and the column comment as the *minimum* width (equal-share flex above it). Verify with `pnpm --filter @weave-ai/ui exec vitest run src/test/v2work.test.tsx`.
- [x] 1.2 Update `packages/ui/src/test/v2work.test.tsx` so the two column-width tests assert one identical growing rule for every column (`flex: 1 1 0`) and the 236px `minWidth` on every column, including the all-empty-except-Done case; verify the updated assertions fail against a rebuilt `0 0 236px` rule (flip the style back, watch them fail, restore) and pass after 1.1.

## 2. Rendered check

- [x] 2.1 `pnpm build`, start a source-built scratch daemon on an isolated config dir and loopback port with a seeded board (most columns empty, one holding several cards), and at 1280×800, 1920×1080, 2560×1440 and 390×844 measure and paste: every column's width equal (±1px); at 1920 and 2560 the columns together fill the kanban's width (no gap wider than 2px on the right); at 1280 columns are 236px and the kanban scrolls horizontally; the 390 phone list is unchanged. Stop the scratch daemon only by its recorded PID.
- [x] 2.2 Capture the board at 1920 dark, 2560 dark and 1920 light before the change (from the pre-change build) and after, store them outside the worktree, report their absolute paths on the ticket, and describe the differences in writing.

## 3. Repo checks

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`; paste both suite blocks verbatim (the core/server block and the UI block) with the worktree clean (`git status --porcelain` empty).
