# Tasks

- [x] 1. In `packages/ui/src/v2/V2Shell.tsx`, build the expanded rail's project row from `p.slug`: `projectRowKey(p.slug)` for the active key and `/v2/w/<ws>/p/<slug>` for the href.
- [x] 2. Audit every other V2 project-page reference (Work cards, ticket header, Live cards, Map, Needs you, More sheet, command palette) for a `name`-vs-slug link; fix any that address the project page by display name, and record what was checked.
- [x] 3. Update `packages/ui/src/test/v2shell.test.tsx` so its project fixtures have a display name that differs from the slug, assert the `/p/<slug>` href, and assert the row highlights when the route names the slug.
- [x] 4. Checks and evidence: `pnpm lint`, `pnpm typecheck`, both test suites, and a dark-theme screenshot of the WeaveAI project page opened from the rail with its row highlighted, on a fixture where name ≠ slug.
