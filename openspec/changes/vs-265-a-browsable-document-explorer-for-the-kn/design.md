## Context

`knowledge_files` already uses `path` as its identity (`UNIQUE (workspace_id, path)`), and
`docPathFor(scope, slug, projectSlug)` is a pure function from scope+slug to a fixed flat path
(`projects/<slug>/docs/<doc>.md`, `workspace/docs/<doc>.md`, `workspace/shared/<doc>.md`). Two call
sites resolve a document by slug today, and — this matters, see Decisions — they are **not** the same
code: `getDoc`/`deleteDoc`/`ensureDoc` (used by `ac_knowledge_note`'s `doc` targeting) go through
`locateDoc`, which calls `docPathFor` directly and treats the one path it computes as the answer.
`resolveLink` (`packages/core/src/knowledge/service.ts:130`, used by `[[slug]]` link indexing) is a
second, independent implementation: it builds candidate paths with a non-throwing `docPathForSafe`
wrapper around the same `docPathFor` and matches on exact `path` equality against `knowledge_files`.
Both assume today's world, where `docPathFor(scope, slug, projectSlug)` is the one place a slug's
document could be — an assumption folders break, and one this design has to remove from both call
sites, not just the one that was easier to find. See proposal.md for why folders are wanted.

## Goals / Non-Goals

**Goals:**
- Add a folder segment to the document path model with no new table and no migration.
- Keep every caller that resolves "the document named `slug` in this scope" working with no path
  knowledge, for both the 29 existing flat documents and any newly foldered one.
- Ship a tree view in the web app reusing the existing document/hub detail panels rather than new
  ones.

**Non-Goals:**
- Editing document bodies in the browser — `DocPanel`/`KnowledgeDocPanel` already support this
  (pre-existing, not part of this change); the explorer reuses it as-is and does not extend it.
- Replacing or touching the force-directed knowledge graph (`KnowledgeGraph.tsx`) — VS-264 owns that.
- Reorganizing the 29 existing documents into folders — a curation decision, left alone.
- Drag-and-drop reordering in the tree. Moving a document is supported (see Decisions) but through an
  explicit action, not drag-and-drop; the acceptance criteria ask that moving not break links, not
  that it be a particular gesture, and drag-and-drop's drop-target/reflow logic is meaningfully more
  UI work for no behavior the spec requires.

## Decisions

### The folder lives in the path; no new column, no migration

`knowledge_files.path` is already the identity and already free-form text. A folder is just more path
between the scope's docs root and the filename: `projects/<slug>/docs/<folder>/<sub>/<doc>.md`. This
is the "richer path" option the ticket names, chosen over a new `folder` column because a column would
have to be kept in sync with `path` (two sources of truth for the same fact) for no benefit — nothing
queries "all documents in folder X" today, and when the explorer needs that list it derives it once
by grouping `listDocs()`'s paths client-side, the same way it currently groups by scope.

`docPathFor(scope, slug, projectSlug, folder?)` gains the optional fourth argument. A new `FOLDER_RE`
validates it: one or more `/`-separated kebab-case segments (`a-z0-9-`, 2-64 chars each), no leading,
trailing or doubled `/`, no `.`/`..` segment. `isDocPath` and `docSlugOf` already key off "ends in
`/docs/<name>.md`" or "is under `workspace/shared/`" — both get widened from `[^/]+` (exactly one
segment) to `(?:[^/]+/)*[^/]+` (any number of segments) so a nested path is still recognized as a
document and its slug is still just the filename stem, unchanged for flat documents.

### Slug resolution searches the scope, not one fixed path — from one shared helper, not two

With folders, a caller that only has a slug (every caller except `putDoc`'s create case) can no
longer compute the path — it has to be looked up. This change introduces one function,
`findDocPath(scope, slug, projectRowId?): string | null`, that looks for an existing `knowledge_files`
row in the target scope (and project, for project scope) whose filename stem equals the slug, checked
across every folder via a `path LIKE` prefix filter then an exact filename-stem check in application
code — precise instead of a fragile broader-match regex, and cheap enough (tens of rows, not
thousands) that no index or cache is needed.

**Both** existing resolution paths are rewritten to call it, because both assumed the old one-path
shape (see Context):
- `locateDoc` calls `findDocPath` first; if found, uses that row's actual path; if not, and a folder
  was supplied (only `putDoc`'s create path does this), computes the new path with
  `docPathFor(..., folder)`; otherwise falls back to the flat path — matching today's behavior exactly
  when no folder is involved.
- `resolveLink` calls `findDocPath` once per candidate scope (the link's own project scope, then
  workspace/decisions, then shared, same order as today) instead of building a candidate path with
  `docPathForSafe` and checking it for exact existence. This is the fix for acceptance criterion 3: a
  `[[slug]]` link to a foldered document now finds it, because resolution no longer depends on the
  document sitting at the one flat path `docPathFor` would compute. `docPathForSafe` is removed —
  nothing needs a "compute a path that might not exist" helper once resolution works by lookup instead
  of by construction.

  **The candidate-scope ordering is existing behavior, not new, and `findDocPath` must not absorb it.**
  `resolveLink` resolves within the linking document's own scope first and falls back to `shared` —
  today, a `[[slug]]` written in a project document that names no project document of that slug already
  resolves to a shared document of that slug. `findDocPath` takes one scope per call; it is
  `resolveLink`'s loop over candidate scopes, unchanged, that gives the fallback. If that loop were
  collapsed into a single call — passing `findDocPath` a list of scopes, or calling it once with
  whichever scope seemed primary — every cross-scope link would stop resolving with no test failure
  unless something exercises that specific case, the same shape of gap as the original miss, one level
  up. `findDocPath` itself is deliberately single-scope; scope fallback stays `resolveLink`'s job.

This also gives slug uniqueness "for free," and specifically why moving needs to be its own explicit
action: since resolution always finds the existing document first, `putDoc` on an already-existing
slug updates that document in place and *ignores* a `folder` argument that disagrees with where it
already lives — a create-time placement, not a per-write override. That is what document-folders'
scenario "Writing to an existing slug updates it in place, ignoring a different folder" specifies.

**On the uniqueness guarantee being real, not assumed:** `UNIQUE (workspace_id, path)` cannot enforce
"one row per slug per scope" once two different folders can produce two different paths for the same
filename — `projects/x/docs/a/foo.md` and `projects/x/docs/b/foo.md` both satisfy that constraint.
What actually prevents the collision is that `putDoc` is synchronous end to end (`node:sqlite` calls
and `readFileSync`/`writeFileSync` are synchronous, and `KnowledgeService.putDoc` returns its result
directly, not a `Promise`) inside a single-process daemon: the `findDocPath` lookup and the
subsequent insert happen with no `await` between them, so no second call can interleave and observe
"not found" for the same slug before the first call's insert completes. This is the same
check-then-insert shape `ensure()` already uses for hub files today; folders do not introduce a new
kind of race, they just remove the `UNIQUE(path)` constraint's ability to act as a backstop for it,
which is why this reasoning has to be stated rather than left to the constraint.

**Alternative considered:** require the caller to pass `folder` on every read/write once a document is
foldered. Rejected — it would mean `ac_knowledge_note(doc: slug)`, `[[slug]]` links, and every other
existing slug-only call site would need to learn a document's folder before it could reach it,
re-adding exactly the path-coupling the ticket says a folder must not become.

### Moving is a deliberate action, not exposed to workers as a tool

A move is supported (`knowledge.moveDoc(actor, scope, slug, projectId, folder)`): update the
`knowledge_files.path` for the one row, physically move the file on disk, re-run the search index
under the new path, and directly rewrite the two kinds of `knowledge_links` rows that cache a path —
`from_path` for the moved document's own outgoing links (it *is* the row that moved), and `to_path`
for every other row's cached resolution of this slug (an `UPDATE ... WHERE to_path = <oldPath>`, no
different from what already happens when a not-yet-existing document's `to_slug` first resolves).
`to_slug` never changes, so nothing that addresses this document by `[[slug]]` needs to know a move
happened.

Reachable through the web app (human/conductor) via a new `POST /knowledge/docs/:scope/:slug/move`
route, not through `ac_knowledge_doc_put` or a new MCP tool. The ticket's acceptance criteria ask that
moving work (or that it be deliberately absent with a reason) — it does not ask for agent-initiated
moves, and folder placement is exactly the kind of organizational, human-facing decision the ticket
frames folders as existing for ("cleaner... browsable by a human"). Keeping it out of the agent tool
surface for this change avoids a worker restructuring the tree as a side effect of an unrelated write
and needing a design for "how does an agent decide when to reorganize" that nothing in the ticket
asks for. If the owner wants agent-initiated moves later, `moveDoc` is already the service method to
expose.

**On a move never being able to collide:** `moveDoc` resolves the source via `findDocPath` (one row,
because slug uniqueness already holds — see above) and computes the destination via
`docPathFor(scope, slug, projectSlug, folder)`, which always ends in `<slug>.md`. A collision would
require some *other* row already filed at that exact destination path — but any row at a path ending
in `<slug>.md` under this scope/project necessarily has this same slug as its filename stem, and
uniqueness already guarantees there is no second row with this slug. So the destination is either
empty or is the source's own current path (a no-op move); no pre-move existence check beyond
"does the source document exist" is needed, and `moveDoc` does not attempt one.

### The explorer is a new tab, not a new page, reusing the existing panels

`Knowledge.tsx` already tabs between `knowledge` (hub grid + flat `DocsPanel` catalogue), `changelog`,
`graph` and `specs`. A fifth tab, `explorer`, gets a new `KnowledgeExplorer.tsx` that:
- Fetches the same data the flat catalogue and hub grid already fetch (`useKnowledgeDocs`,
  `useKnowledgeIndex`) — no new list endpoint.
- Builds a tree client-side by splitting each document's folder (derived from `path` via a new
  `docFolderOf`, mirrored in `refFromPath`'s widened regexes) into nodes, with each scope's hub file
  injected as a distinguished node at that scope's root (a different row style, not a folder icon —
  the spec calls out that it must not require opening the file to tell hub from document).
- Opens documents in the existing `DocPanel` and hubs in the existing `KnowledgeDocPanel`, exactly as
  `KnowledgePanel` and `GraphPanel` already do — this is why the explorer needs no new document-detail
  UI and does not touch editing.
- Adds one collapsed "Archive" row per scope when that scope has archive files, populated by a small
  new read-only route (`GET /knowledge/:scope/archive?project=` listing dated filenames, `GET
  /knowledge/:scope/archive/:date?project=` for one file's content) that reads the `archive/*.md`
  files `archiveEntries()` already writes today (curation, document deletion) — these are not
  `knowledge_files` rows and are not indexed or linkable, so they are surfaced as plain read-only text,
  not folded into the document tree.

**Alternative considered:** a dedicated route/page instead of a tab. Rejected — the Knowledge page
already carries the project filter and search bar the explorer needs, and a new page would either
duplicate that chrome or leave the explorer unable to share it.

## Risks / Trade-offs

- [Two documents collide on the same slug in different folders] → prevented by `putDoc`'s
  check-then-insert being entirely synchronous within a single-process daemon, not by a database
  constraint — see "On the uniqueness guarantee being real, not assumed" above; this is not a new race
  class, just one `UNIQUE(path)` can no longer backstop, which is why it is spelled out rather than
  assumed.
- [A second, independent path-resolution implementation existed and was missed] → this is exactly what
  went wrong in the first draft of this design (`resolveLink` was not routed through the same lookup as
  `locateDoc`); the fix is architectural, not just a bug fix — `docPathForSafe` is removed and both
  call sites now share one `findDocPath`, so there is no second implementation left to drift.
- [Widening `isDocPath`'s regex to accept nested segments could reclassify something that is not
  actually a document] → the regex still requires ending in `/docs/<name>.md` or sitting under
  `workspace/shared/`; nothing else on disk matches that shape today or would start to.
- [The archive-listing routes read the filesystem directly, unlike every other knowledge route which
  reads through `knowledge_files`] → they are read-only, scoped to a known `archive/` directory
  computed the same way `archiveEntries()` computes it, and never referenced by slug or link — no new
  write path, no new indexing to keep in sync.

## Migration Plan

No data migration: existing rows' `path` values are unchanged and already match the "no folder" case
of the widened parsing functions. No feature flag — the folder argument is optional and additive, and
the explorer is a new tab nothing depends on. Rollback is a plain revert; nothing persisted depends on
the new code path once flat documents are the only kind ever moved.
