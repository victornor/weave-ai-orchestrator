## 1. The mark component

- [x] 1.1 Add `packages/ui/src/components/WeaveMark.tsx`: the `mark-svg` document's `<svg>` inlined verbatim (four paths, viewBox `0 0 1860.444515 413.681337`, `fill="currentColor"`), the provenance comment kept as a JSX comment, and props `{ className?: string; title?: string }` that render `role="img"` + `aria-label={title}` when `title` is given and `aria-hidden` otherwise. Verify the inlined SVG block is identical to the document's code fence by diffing the extracted `<svg>…</svg>` against it.
- [x] 1.2 Add `packages/ui/src/test/weaveMark.test.tsx`: with a `title` the svg is an image named that title; without one it is hidden from assistive technology; the svg carries the document's `viewBox` and sets no `width` or `height` attribute, so the ratio comes from the viewBox. Verify with `pnpm --filter @weave-ai/ui exec vitest run src/test/weaveMark.test.tsx`.

## 2. Place it on the three surfaces

- [x] 2.1 Add a `flex-none` brand block at the top of the sidebar rail in `packages/ui/src/app/WorkspaceNav.tsx`, above `<nav aria-label="Global">`, rendering `WeaveMark` with `title="Weave"` at a height in the 28–40px band that fits the rail's ~188px usable width (the rail is 208px with `p-2.5`); verify `src/test/workspacenav.test.tsx` shows the mark inside the sidebar, above the Global nav, and that the existing nav entries are unchanged.
- [x] 2.2 Replace the placeholder accent tile in `packages/ui/src/routes/Login.tsx` with `WeaveMark` (no `title`, so `aria-hidden`), keeping the heading text; settle the mark's height, the gap to the heading and whether the mark sits left of or above the heading against the render (the mark is ~126px wide at 28px tall, four and a half times the square it replaces), and state the choice in the report. Verify `src/test/login.test.tsx` shows the mark and the heading, and that the mark is hidden from assistive technology.
- [x] 2.3 Replace the placeholder accent tile in `packages/ui/src/routes/Onboarding.tsx`'s `Frame` the same way, with the same settled lockup as login; verify `src/test/onboarding.test.tsx` shows the mark and the heading on the first-run and new-workspace frames.
- [x] 2.4 Confirm no `w-full`, fixed `width`, `height` attribute, `object-fit`, or letterbox wrapper is applied to any of the three call sites, and that each passes only a height plus `w-auto`. Verify by reading the three call sites.

## 3. Verify and look at it

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; paste both suite blocks verbatim in the report. Verify all green.
- [x] 3.2 Render the real running app (per [[ui-screenshot-harness]]) and capture the sidebar, the login screen and the onboarding screen in the dark theme; capture the sidebar at a narrow width to confirm no new scrollbar and no layout shift, and confirm the light theme legibility. Deliver the images as uncommitted files under the worktree and report their absolute paths.
- [x] 3.3 Look at the captures against the acceptance: threads run in and out, no squash, no crop, no letterbox, the login/onboarding lockup is not cramped at its settled gap and orientation, and the rail shows no new scrollbar. If anything looks cramped or the ratio is off, say so on the ticket instead of reporting done.
