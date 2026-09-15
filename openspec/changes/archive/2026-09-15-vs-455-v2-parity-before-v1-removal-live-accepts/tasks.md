# Tasks

- [x] 1. Create the tracker change (`.openspec.yaml`, `proposal.md`, `tasks.md`).
- [x] 2. In `packages/ui/src/v2/LivePage.tsx`, seed the scope from an optional `ws` search param and write the chosen scope back to the URL with `replace` on a chip change, leaving `?worker=` and the no-param default (Everywhere) unchanged.
- [x] 3. In `packages/ui/src/router.tsx`, add the `/v2/w/$ws/team` route that redirects to `/v2/w/$ws/roles`, mirroring V1's alias.
- [x] 4. Tests: `?ws=<id>` pre-selects the scope chip and filters the grid; a chip change updates the URL; `/v2/w/$ws/team` lands on Roles.
- [x] 5. Checks and evidence: `pnpm lint`, `pnpm typecheck`, both test suites, and dark- and light-theme captures of Live opened with `?ws=` under `docs/reviews/vs-455/`.
