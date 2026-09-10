## 1. Stub detection and graph membership

- [x] 1.1 Add a hub-stub helper in `packages/core/src/knowledge/files.ts`: a
      hub is a stub when `parseDoc` finds no section entry (non-blank,
      non-comment, not a `(...)` fill-in hint) and the file has no resolved
      wiki-link. Verify with colocated cases: seed decisions.md is a stub;
      SHARED.md with a house-rule bullet is not; headings-only is a stub.

- [x] 1.2 In `KnowledgeService.graph()`, omit a workspace-scoped hub that is
      a stub unless it is needed as a parent (task 2.1). Change the project
      filter from `projectId === pid || scope === 'shared'` to
      `projectId === pid` only. Verify `knowledge.test.ts`: unscoped graph
      drops stub decisions.md; unscoped graph keeps SHARED.md that has
      convention notes; `graph(projectId)` has no SHARED / decisions /
      WORKSPACE nodes and still has the project hub → its docs.

## 2. Honest workspace-scope edges

- [x] 2.1 When both endpoints are in the unscoped graph, append structural
      edges `workspace/WORKSPACE.md` → `workspace/SHARED.md` and
      `workspace/WORKSPACE.md` → `workspace/decisions.md`. If WORKSPACE.md
      is a stub but SHARED or decisions survived, still emit the workspace
      node. Do not write these edges to `knowledge_links`. Verify
      `knowledge.test.ts`: populated SHARED has an edge from the workspace
      hub; no edge from SHARED or decisions to a project hub unless a
      wiki-link exists; a stub WORKSPACE.md still appears when SHARED has
      notes.

## 3. Docs and checks

- [x] 3.1 Document on `GET /knowledge/graph` in `docs/API.md` that stub
      workspace hubs are omitted and that the unscoped graph adds
      workspace → shared / decisions edges. Verify the sentence is there
      next to the existing graph payload description.

- [x] 3.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all
      are green.
