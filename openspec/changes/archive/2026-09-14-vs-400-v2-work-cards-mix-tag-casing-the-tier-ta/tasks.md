# Tasks

- [x] 1. In `packages/ui/src/v2/work/Work.tsx`'s `WorkCard`, render the kind, worker-model tier, `needs you` and `spec archive pending` tags in one uppercase casing: the tier through the `.v2-tag` recipe using `workerModelTagLabel` instead of `WorkerModelTag` → `Badge`, and every tag in the row carrying the `uppercase` class. `Badge` is unchanged.
- [x] 2. Test in `packages/ui/src/test/v2work.test.tsx`: a card with a tier tag, a kind tag and a `needs you` tag asserts all three carry exactly one casing (uppercase, and no lowercase/capitalize), which fails if the tier keeps `Badge`'s casing alone.
- [x] 3. Rendered check: V2 Work kanban, dark and light, on an isolated scratch daemon seeded with a second worker-model option so the tier tag shows, compared against the Work reference shot (`Weave Control Plane Redesign/shots/desktop-{dark,light}/03-work.png`, source `docs/design/v2/Screens.dc.html`). `pnpm lint`, `pnpm typecheck` and both suites pass.
