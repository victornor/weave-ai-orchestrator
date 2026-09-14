# Tasks

- [x] 1. In `packages/ui/src/v2/work/Work.tsx`, gate the desktop-only toolbar to `md` and up: the Finished/view-switch/New-ticket row and the search/four-filter row each become `hidden … md:flex`, so phone renders none of them. The merge strip stays visible.
- [x] 2. Add the phone reference's compact scope-tab row (`md:hidden`, `data-v2-work-scope`) above the merge strip: `All work` (clears the scope), `Needs you` (the tickets with an open human decision), and one chip per project (reusing the existing project filter). `All work`/`Needs you`/a project are mutually exclusive.
- [x] 3. Test in `packages/ui/src/test/v2work.test.tsx`: the two desktop toolbar rows carry the hidden-below-`md` gate and the phone scope row carries the `md:hidden` gate; `Needs you` narrows the phone list to a needs-you ticket and hides the others; a project chip and `All work` filter and restore it.
- [x] 4. Rendered check on an isolated scratch daemon, phone and desktop, dark and light, compared against `Weave Control Plane Redesign/shots/*/03-work.png`; list any differences. `pnpm lint`, `pnpm typecheck` and both suites pasted verbatim.
