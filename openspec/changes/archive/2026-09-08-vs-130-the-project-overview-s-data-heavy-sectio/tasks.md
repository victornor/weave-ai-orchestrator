## 1. Section shell

- [x] 1.1 Add `scrollable: boolean` to `ProjectSectionDef` in `packages/ui/src/routes/project/sections.tsx`, and mark `needs`, `work`, `landing`, `history`, `pulls`, `landings`, `knowledge` as `true` and `activity` as `false` in `PROJECT_SECTIONS`, per design.md's per-section rationale. Verify with `pnpm typecheck`.
- [x] 1.2 In `ProjectSection`, when the section is `open` and `scrollable`, apply `overflow-y-auto` plus a `max-h-[calc(var(--ac-app-h)*0.4)]` class to the existing body `div` (not the `.ac-scroll` utility, which would set `overscroll-behavior: contain` and trap the page scroll — see design.md). Leave a closed or non-scrollable section's body exactly as it renders today. Verify by reading the rendered class list in a quick manual render or the test in 3.1.

## 2. Existing behaviour untouched

- [x] 2.1 Confirm no section body changes: `ActivitySection.tsx` keeps its `SHOWN = 12` slice unchanged, and no other section file is edited. Verify with `git diff --stat` showing only `sections.tsx` (plus its test) touched.
- [x] 2.2 Confirm the desktop two-column grid (`ProjectOverview.tsx`'s `grid-cols-3` / `md:col-span-2`) and the collapse/expand disclosure are unmodified. Verify by reading the diff.

## 3. Tests

- [x] 3.1 Add a test in `packages/ui/src/test/` (colocated with the existing project-overview/section tests) asserting: `PROJECT_SECTIONS` marks exactly the seven sections named in 1.1 as `scrollable: true` and `activity` as `false`; and rendering `ProjectSection` with `scrollable` true applies both the `overflow-y-auto` and `max-h-[calc(var(--ac-app-h)*0.4)]` classes to its body regardless of child count (render with a small number of children and with many, asserting the classes are present and every child is still in the DOM in both cases — nothing is sliced), while rendering it with `scrollable` false (or `open` false) applies neither. Verify with `pnpm --filter @agent-conductor/ui exec vitest run`.
- [x] 3.2 Run the full suite and confirm nothing else broke: `pnpm typecheck`, `pnpm lint`, `pnpm test` all green.

## 4. Manual verification

- [x] 4.1 Run the app against a project seeded with enough commits, pull requests, tickets and landings to overflow the 40%-viewport cap (state the exact counts used in the PR), and confirm at a desktop width and at a 390px phone width: a capped section scrolls internally and reaching the end of its content continues scrolling the page; a short/uncapped section shows no scrollbar. Capture screenshots of both for the PR.
