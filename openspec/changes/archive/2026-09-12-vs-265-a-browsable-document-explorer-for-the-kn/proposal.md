## Why

The knowledge base is already a tree of linked documents on disk (`knowledge_files.path` is the
identity), but nothing lets a document live anywhere but a flat `docs/` per scope, and nothing lets a
human browse that tree. Writers already fake folders with filename prefixes (`research-*`,
`design-*`, 9 of 29 documents today). captain asked for real folders plus a polished, file-explorer
style view so the knowledge base is browsable by a human, not just queryable by agents.

## What Changes

- A linked document can be created at a folder path within its scope (project/workspace/shared docs),
  nested at least two levels deep, via the same `ac_knowledge_doc_put` tool agents already use — an
  optional `folder` argument, defaulting to none (today's flat layout, unchanged for all 29 existing
  documents).
- A document's identity stays its slug, not its path: `[[slug]]` links, `ac_knowledge_doc_get`,
  `ac_knowledge_note`'s `doc` targeting and the backlink index all keep resolving a document by slug
  regardless of which folder it lives in. Slug uniqueness is enforced within a scope (and project, for
  project-scoped documents) across every folder, not just at one fixed path.
- A document can be moved to a different folder after creation, by the conductor or a human through
  the web app (not exposed to workers as an agent tool in this change — see design.md for why). Moving
  updates the file's path only; no link changes, because links never carried a path.
- A new "Explorer" view in the web app's Knowledge page: a folder tree of every scope's documents,
  hub files (`PROJECT.md`, `WORKSPACE.md`, `SHARED.md`) shown distinctly since they are governed
  differently, click-to-open reusing the existing document panel (body, links, backlinks), and a
  collapsed per-scope node exposing the dated archive files that document deletion and curation
  already write to disk today but nothing currently surfaces.
- `ac_knowledge_docs` and the `GET /knowledge/docs` route report each document's folder so the
  catalogue and the explorer agree.

## Capabilities

### New Capabilities
- `knowledge/document-folders`: a linked document's path model gains an optional folder component
  within its scope; creation, slug-uniqueness-across-folders, and moving a document between folders.
- `knowledge/document-explorer`: the web app's folder-tree view over the knowledge base — the tree
  itself, opening a document or hub from it, and surfacing the per-scope archive.

### Modified Capabilities
(none — `knowledge/document-notes`, `knowledge/graph-exploration`, `knowledge/health` and the others
already resolve documents by slug and are unaffected by where a document's file happens to sit)

## Impact

- `packages/core/src/knowledge/files.ts`: `docPathFor`, `isDocPath`, `docSlugOf` gain folder support; a
  new `FOLDER_RE` and `docFolderOf`.
- `packages/core/src/knowledge/service.ts`: `locateDoc` resolves an existing document by slug across
  folders before falling back to a requested folder; `putDoc` accepts a creation-time `folder`; a new
  `moveDoc`.
- `packages/core/src/api.ts`: `KnowledgeDocSummary.folder`, `KnowledgeService.moveDoc`.
- `packages/server/src/tools.ts`: `ac_knowledge_doc_put` gains `folder`.
- `packages/server/src/routes/knowledge.ts`: `PUT /docs/:scope/:slug` accepts `folder` on create;
  new `POST /docs/:scope/:slug/move`; a small archive-listing route per scope.
- `packages/ui`: new `KnowledgeExplorer.tsx` route/tab, `refFromPath` in `KnowledgeDocs.tsx` updated
  for nested paths, a move affordance on `DocPanel`.
- `packages/cli/src/commands/knowledge.ts`: `docs` table gains a `folder` column.
- `docs/PLAN.md` §13, `docs/API.md`: documented.
