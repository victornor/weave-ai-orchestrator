## 1. The shared renderer: a split diff never crosses its column

- [x] 1.1 In `packages/ui/src/components/DiffHunks.tsx`, give each `SplitHunk` column wrapper `min-w-0` and `overflow-hidden`, and make each row's code span carry the code forward without crossing the column: the line-number span stays `flex-none` and the code span becomes `min-w-0 flex-1 whitespace-pre-wrap break-words`. Verify with a `transcript.test.tsx` case that a split hunk's two column wrappers both carry `min-w-0`, and that each row's code span carries `whitespace-pre-wrap`, `break-words`, `min-w-0` and `flex-1`.
- [x] 1.2 Confirm `SplitHunk`'s grid stays `grid-cols-2` (Tailwind's `minmax(0, 1fr)` tracks) so a column cannot widen the grid: verify a test asserts a very long single-token line renders a `grid-cols-2` grid whose column wrappers carry `min-w-0`, i.e. the structural condition under which the grid cannot exceed its container in a real browser (jsdom does not measure this; the class contract is what the suite pins).

## 2. Unified keeps both of its uses

- [x] 2.1 Add `wrap?: boolean` to `UnifiedHunk`, defaulting to `true`: when `wrap` the code span carries `min-w-0 flex-1 whitespace-pre-wrap break-words`; when not, it keeps today's `whitespace-pre` and the caller's outer `overflow-x-auto`. Verify with a `transcript.test.tsx` case asserting the wrap classes on the default render and their absence when `wrap={false}`.
- [x] 2.2 In `packages/ui/src/routes/project/PullRequestDiff.tsx` pass `wrap={false}` to its `UnifiedHunk` so the pull-request view keeps horizontal scrolling; leave its `SplitHunk` on the new wrapping behavior. Verify `pullRequestDiff.test.tsx` still finds a single column and no `grid-cols-2` in unified, and that its side-by-side columns now carry the no-overflow/wrap classes.
- [x] 2.3 Verify the pull-request phone path is unchanged: existing `pullRequestDiff.test.tsx` "always unified at a phone width" still passes, and no horizontal-scroll-inducing width class appears (`[class*="min-w-["]`, `[class*="w-screen"]` tests still green).

## 3. The side-by-side threshold

- [x] 3.1 In `packages/ui/src/components/Transcript.tsx`'s `EditHunk`, change the container-query threshold from `32rem` to `48rem` (both the `@min-[…]:block` split wrapper and the `@min-[…]:hidden` unified wrapper) and remove the now-dead outer `overflow-x-auto`, since both hunks wrap. Verify with a `transcript.test.tsx` case that the split wrapper carries `@min-[48rem]:block`, the unified wrapper `@min-[48rem]:hidden`, and no `32rem` container class remains.

## 4. Tests and the full gate

- [x] 4.1 Update the existing VS-324 test that names `@min-[32rem]` to the chosen value and extend the edit-rendering `describe` in `packages/ui/src/test/transcript.test.tsx` with the class-contract cases from 1.1, 1.2, 2.1 and 3.1.
- [x] 4.2 Run `pnpm lint && pnpm typecheck && pnpm test` and paste **both** suite blocks verbatim in the report (core/server, then UI) — never summed, never one block claiming to be both.
- [x] 4.3 Verify the rendered layout by eye at a wide and a narrow cell width against
  `live-diff-split-wanted.png` and `live-diff-unified-wanted.png`; render any screenshots to a
  directory outside `work/` (the workspace rules forbid untracked review assets in the worktree)
  and state which parts are visual-only. `git status --porcelain` in `work/` must be empty before
  requesting review.

## 5. Deliver

- [x] 5.1 Commit each task or logical group with the ticket id, push the branch, record the pull
  request as a work product, and transition to `in_review`.
