## 1. Path model: folders in `packages/core/src/knowledge/files.ts`

- [x] 1.1 Add `FOLDER_RE` and widen `docPathFor(scope, slug, projectSlug, folder?)` to accept an
      optional folder segment, validated against it; unit-test valid nesting (>=2 levels), the
      no-folder case unchanged, and rejection of uppercase/`..`/leading-trailing-doubled-slash folders.
- [x] 1.2 Widen `isDocPath` and `docSlugOf` to recognize any depth under `docs/` or `workspace/shared/`
      (not just exactly one segment); unit-test both the flat and nested shapes, and that non-document
      paths (hub files) are still excluded.
- [x] 1.3 Add `docFolderOf(rel): string | null` returning the folder portion (or `null` when flat);
      unit-test flat, one-level and multi-level paths.

## 2. Service layer: `packages/core/src/knowledge/service.ts`

- [x] 2.1 Add one shared `findDocPath(scope, slug, projectRowId?): string | null` lookup (existing
      document row by slug across every folder in a scope + project). Rewrite **both** existing
      resolution paths to call it — do not leave either on the old one-path assumption:
      - `locateDoc`: use `findDocPath` first; if not found and a `folder` was supplied (create case),
        compute the new path with `docPathFor(..., folder)`; otherwise fall back to the flat path.
      - `resolveLink`: **keep its existing cross-scope fallback** — it tries the linking document's own
        project scope, then `workspace` (if the linking document is `workspace`/`decisions` scope), then
        `shared`, and takes the first hit. Call `findDocPath` once per candidate scope, in that order,
        stopping at the first non-null result — do **not** push the scope list down into `findDocPath`
        itself or have `resolveLink` call it with only one scope. Collapsing the fallback into a
        single-scope lookup silently breaks every project-to-shared (or workspace-to-shared) link with
        no test failure unless one specifically exercises a cross-scope link — this was flagged in plan
        review as the same class of gap as the original miss, one level up. Delete `docPathForSafe` once
        nothing calls it.
      Before writing this task's code, grep for every remaining caller of `docPathFor`/`docPathForSafe`
      across `packages/` and confirm each one is covered (only these two call sites existed as of the
      design; re-check, do not assume the list is still accurate) — this is the check the plan review
      asked for, do it before, not after, changing the code.
      Unit-test that `getDoc`/`ensureDoc`/`deleteDoc` **and** `resolveLink`'s own indexing path each
      find a foldered document by slug alone.
- [x] 2.2 Thread an optional `folder` parameter through `putDoc`; on create, place the new file at that
      folder; on update of an existing slug, resolve to the existing path and ignore a disagreeing
      `folder` argument (per the design's chosen semantics) — unit-test both branches.
- [x] 2.3 Add `moveDoc(actor, scope, slug, projectId, folder)` to the `KnowledgeService` interface and
      implementation: update the file's row `path`, move the file on disk, re-index search under the
      new path, rewrite this document's own `from_path` rows and every other row's `to_path` rows that
      pointed at the old path, reject with `not_found` when the slug does not resolve. No pre-move
      collision check is needed (see design's "a move never able to collide"). Unit-test that a
      document with existing backlinks keeps resolving from both directions after a move, and that
      moving a nonexistent slug is rejected without touching disk or the index.
- [x] 2.4 Add `folder: string | null` to `KnowledgeDocSummary` (populated via `docFolderOf`) in
      `packages/core/src/api.ts` and `docSummaryOf`; verify `listDocs`/`getDoc` report it.
- [x] 2.5 **Acceptance criterion 3, tested directly and end to end**, two cases, both via `putDoc` (the
      real write path that calls `indexLinks`/`resolveLink`, not a direct call to `findDocPath` or
      `locateDoc` standing in for it):
      - Same-scope: create a document inside a folder, write `[[that-slug]]` into a second document in
        the same scope, assert the link resolves (`to_path` set, `ac_knowledge_doc_get`'s `linksTo`
        shows it resolved) and the backlink index finds it (`linkedFrom` on the target lists the
        linking document).
      - **Cross-scope fallback preserved:** create a document inside a folder in the **shared** scope,
        write `[[that-slug]]` from a **project** document with no project document of that slug, assert
        it still resolves to the shared document — today's fallback behaviour (see 2.1), not new
        behaviour, must keep working once folders exist.
      Both are the scenarios the plan review found broken or at risk in the first two drafts — test the
      actual link path, not a proxy for it.
- [x] 2.6 Regression test: run the existing knowledge test suite's document fixtures (or the real
      workspace layout if a test already does this) to confirm every currently-flat document still
      resolves, lists and links unchanged — the acceptance criterion that none of the 29 need a manual
      move.

## 3. Tool, HTTP and CLI surface

- [x] 3.1 Add optional `folder: z.string().optional()` to `ac_knowledge_doc_put`'s input schema in
      `packages/server/src/tools.ts` and pass it through to `putDoc`; update the tool description.
- [x] 3.2 `PUT /docs/:scope/:slug` in `packages/server/src/routes/knowledge.ts` accepts `folder` in the
      body and passes it through; add `POST /docs/:scope/:slug/move` taking `{ folder }` (empty/absent
      folder means move to the scope root) calling `moveDoc`.
- [x] 3.3 Add the archive-listing routes: `GET /knowledge/:scope/archive` (list dated files for a scope,
      optionally `?project=`) and `GET /knowledge/:scope/archive/:date` (one file's raw content),
      reading the same `archive/` directory `archiveEntries()` writes to; 404 when no archive exists.
- [x] 3.4 Add a `folder` column to `conductor knowledge docs`'s table output in
      `packages/cli/src/commands/knowledge.ts`.
- [x] 3.5 Document the new/changed routes in `docs/API.md` and the folder model in `docs/PLAN.md` §13.

## 4. Web app: explorer view

- [x] 4.1 Widen `refFromPath` in `packages/ui/src/routes/KnowledgeDocs.tsx` to parse nested folder
      segments for all three scopes (project/workspace/shared), matching the widened server regexes.
- [x] 4.2 Add `useKnowledgeMoveDoc` (or extend the existing knowledge mutation hook) calling
      `POST /docs/:scope/:slug/move`, and API types for the `folder` field and the archive list/content
      endpoints in `packages/ui/src/api`.
- [x] 4.3 Build `packages/ui/src/routes/KnowledgeExplorer.tsx`: group `useKnowledgeDocs`'s results by
      folder into a tree per scope, inject each scope's hub as a distinguished root-level entry (reuse
      `useKnowledgeIndex`'s hub rows), expand/collapse folders, open documents via the existing
      `DocPanel` and hubs via the existing `KnowledgeDocPanel`. Use only existing tokens/components
      (`index.css`, `Button`, `Badge`, card/list patterns from `KnowledgeDocs.tsx`).
- [x] 4.4 Add a per-scope collapsed "Archive" entry in the tree, populated from the new archive-list
      route, opening a read-only raw-markdown view of a selected dated file (reuse `Markdown`).
- [x] 4.5 Add a move affordance to `DocPanel` (e.g. an inline folder field next to Edit/Delete) that
      calls the new move mutation and refreshes the tree.
- [x] 4.6 Register the `explorer` tab in `Knowledge.tsx`'s `TABS`/`Tabs` alongside `knowledge`,
      `changelog`, `graph`, `specs`, rendering `KnowledgeExplorer`.
- [x] 4.7 Component test(s) for `KnowledgeExplorer`: a nested document is reachable through its folder
      chain, a hub renders distinctly from a document, and the archive entry only appears when archive
      files exist — per the document-explorer spec's scenarios.
- [x] 4.8 Visual check in both light and dark mode (screenshot via the project's UI screenshot harness,
      since no daemon may be launched against live credentials); confirm no hardcoded color.

## 5. Verification

- [x] 5.1 `pnpm lint && pnpm typecheck` clean.
- [x] 5.2 `pnpm test` — paste both the core/server and UI suite blocks verbatim with real totals.
- [x] 5.3 Confirm against the real current `knowledge/` layout (not a fixture) that all 29 existing
      documents still resolve and appear, satisfying acceptance criterion 2 directly.
