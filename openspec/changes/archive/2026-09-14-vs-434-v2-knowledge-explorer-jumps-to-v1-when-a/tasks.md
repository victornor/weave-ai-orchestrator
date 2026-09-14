# Tasks

- [x] 1. Add `packages/ui/src/app/host.tsx`: the `HostRoutes` context with `V1_HOST_ROUTES` as the default and `V2_HOST_ROUTES` for `/v2`, and a `HostRoutesProvider`.
- [x] 2. Provide `V2_HOST_ROUTES` in `packages/ui/src/v2/V2Root.tsx` around the V2 tree.
- [x] 3. In `packages/ui/src/routes/KnowledgeExplorer.tsx`, write the selection to `host.knowledgeExplorer` (with the host's extra search) and open a weaver artifact at `host.artifact`, instead of hard-coded `/w/…` paths.
- [x] 4. In `packages/ui/src/routes/KnowledgeDocs.tsx`, point `KnowledgeDocPanel`'s revision ticket link at `host.ticket`.
- [x] 5. Test both hosts: V2 keeps doc, hub, archive and artifact navigation under `/v2/…` with the expected search and `replace`; V1 paths are unchanged; the revision ticket link differs by host.
- [x] 6. Checks and evidence: `pnpm lint`, `pnpm typecheck`, both test suites, and real-browser V2 captures (dark and light) of the Explorer with a document open and after opening an artifact, each with the current path visible under `/v2/w/…/knowledge/explorer`.
