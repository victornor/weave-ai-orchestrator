# Tasks

- [x] 1. Add `packages/ui/src/lib/changeTree.ts`: a pure `buildChangeTree(files)` that groups `DiffFileSummary[]` into collapsible folders carrying per-folder +N/–N, and a filter helper. Unit-test grouping, counts, badges and filtering in `lib/changeTree.test.ts`.
- [x] 2. Add `packages/ui/src/lib/wholeFile.ts`: a pure `wholeFileHunk(file, baseLines)` that merges a file's hunks with its base-revision lines into one synthetic `DiffHunk` covering the whole file. Unit-test modified, added, deleted and renamed files in `lib/wholeFile.test.ts`.
- [x] 3. Build the V2 change explorer: a page component with the PR header (title, `head → base`, head SHA, totals) and a `Back` control, resolving the project from the route param.
- [x] 4. File tree (left): collapsible folders, status badge, +N/–N per file and folder, filter box, selected-file highlight, and up/down + enter keyboard navigation.
- [x] 5. File view (right): whole file by default via `wholeFileHunk`, a `Changes only` toggle back to hunks, unified/split via `DiffHunks` and `useDiffLayout`, and graceful binary/too-large/added/deleted states.
- [x] 6. Layout: tree and panel side by side on desktop, stacked with a back step on a phone; V2 tokens and motion, reduced motion respected.
- [x] 7. Add the `Review changes` control to `V2DecisionCard`'s `merge_approval` branch: resolve the PR number from the ticket's `pull_request` work product and the project slug from props, and hide the control when neither resolves; pass `projectSlug` from the chat call sites too.
- [x] 8. Wire the route `/v2/w/$ws/p/$project/changes/$number` (search `file`) into `router.tsx` and `v2/pages.tsx`.
- [x] 9. UI tests: the button resolves and hides; the tree groups/counts/badges/filters; selecting a file loads its whole-file view; the changes-only and unified/split toggles; binary and too-large states; the route deep-links to a file; keyboard navigation.
- [x] 10. Checks and evidence: `pnpm lint`, `pnpm typecheck`, both test suites, and real-browser captures (dark and light, desktop and phone width) of the merge card button, the whole-file view, split view, an added file and a removed file.