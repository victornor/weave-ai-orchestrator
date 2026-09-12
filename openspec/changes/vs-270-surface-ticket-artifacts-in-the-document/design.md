## Context

See `proposal.md` for motivation. Both blockers are merged: VS-265 (`packages/ui/src/routes/
KnowledgeExplorer.tsx`, `packages/ui/src/lib/knowledgeExplorer.ts`) built the document-explorer tree;
VS-269 (`packages/core/src/tickets/service.ts`, `packages/server/src/routes/tickets.ts`,
`packages/ui/src/routes/TicketPage.tsx`) built artifact storage, serving and the ticket-page viewer.
Relevant existing shape, confirmed by reading the current code:

- `ticket_work_products` (migration `0001_init.sql:86-89`) already has every column this ticket needs:
  `ticket_id`, `type` (CHECK-allows `'artifact'`), `external_id` (the artifact key), `url` (the raw
  serve path VS-269 already writes), `title`, `metadata_json` (`kind` lives here), `updated_at`. No
  migration required.
- `tickets.putArtifactWorkProduct` (`service.ts:1015-1041`) is the one writer of an artifact work
  product; it always sets `url` to the ticket-scoped raw path and bumps `updated_at` on republish. This
  ticket only reads that table — it never writes it.
- `GET /:id/artifacts/:key/raw[?revision=N]` (`routes/tickets.ts:131-141`) is the one serving route,
  already `requireOperator`-gated with the sandbox CSP. The stored `url` on the work product already
  points at this exact path — nothing new needs to compute or duplicate it.
- The ticket page's `ArtifactsTab` (`TicketPage.tsx:651-766`) already builds the iframe + revision
  picker + open/copy/download actions from a ticket's own `useTicketWorkProducts` list. This is the
  "sandboxed viewing path" the ticket says to reuse rather than re-render.
- `KnowledgeExplorer.tsx` renders one root section per (scope, project) pair from `buildExplorerTree`
  (a pure function over `KnowledgeDocSummary[]` + hub refs). Artifacts have no slug, no folder, and are
  explicitly not knowledge documents (ticket's Out of scope), so they must not enter that model —
  adding them there would be exactly the "linkable by slug" identity the ticket forbids.
- `events.ts`'s `TRACKED` array already includes `ticket.work_product`, fired by
  `putArtifactWorkProduct` on every publish/republish; its `invalidateFor` switch already invalidates
  `qk.ticketWorkProducts`, `qk.changelogRoot`, `qk.pullRequestsRoot`, `qk.historyRoot` for that event —
  none of which the explorer reads. A new query key needs the same treatment.
- `qk` (`packages/ui/src/api/keys.ts`) documents its own lesson twice already (`pullRequestsRoot`,
  `historyRoot`, comments at `keys.ts:94-96,103`): a list whose staleness is driven by *ticket* events
  must have its own root key, not live nested under a domain (`projects`, `knowledge`) that only *that
  domain's* events invalidate — VS-95/VS-97 both shipped with the list nested wrong and went stale.

## Goals / Non-Goals

**Goals**
- One place, the document explorer, to find any artifact in a project without already knowing which
  ticket produced it.
- Zero new rendering path for artifact HTML: the explorer's viewer is the same route, same CSP, same
  React component logic as the ticket page's, verified by an explorer-specific header check rather than
  trusted from VS-269's existing test.
- No artifact gains slug/link/graph identity as a side effect of becoming browsable.

**Non-Goals** (see proposal.md's Impact and the ticket's own Out of scope list)
- Moving artifacts into knowledge storage or ticket documents' folder model.
- Editing, annotating, or deleting artifacts from the explorer.
- Any change to `ac_ticket_artifact_put`, the read-back closure, or the raw-serve route's contract.

## Decisions

### 1. The Artifacts entry is a flat, recency-sorted list — not grouped by ticket or kind

The ticket explicitly asks for this call to be made and argued. Rejected both alternatives:

- **Grouped by ticket**: the obvious first guess (every artifact belongs to exactly one ticket, and the
  explorer already groups documents into folders), but the ticket's own framing names the failure mode
  directly — a reader looking for "the architecture explainer" often does not remember which ticket
  produced it, so forcing a ticket-first navigation recreates the exact discovery problem this ticket
  exists to solve.
- **Grouped by kind**: `kind` is optional, free-text metadata an agent may or may not set when
  publishing (`ac_ticket_artifact_put`'s `kind?` parameter, stored in `metadata_json`, no enum, no
  validation). Grouping by an optional, uncontrolled string produces an unstable set of folders
  (including an "unset" bucket) that says less about the artifact than its title already does.

**Chosen**: one flat list, sorted by `updated_at` descending, each row showing title, a ticket badge
(identifier, and title on hover/expansion), kind when set, and updated-at — the same four facts either
grouping would have organized around, just not used as a filter a reader has to already have the answer
to. This also matches the expected scale: artifacts are agent-authored work products, not user uploads,
so a project's total count stays small enough that a flat list scans faster than opening folders. If
volume changes that calculus later, grouping/filtering is additive on top of this list, not a rework of
its data.

### 2. New read lives in the tickets service, exposed under the knowledge route namespace

The data (`ticket_work_products` joined with `tickets` for identifier/title) is entirely tickets-owned,
so the query method belongs in `packages/core/src/tickets/service.ts` — call it `artifacts(projectId:
string | null)` — alongside `workProducts`, `documents`, `putArtifactWorkProduct`. It is a plain read:

```sql
SELECT wp.id, wp.ticket_id AS ticketId, t.identifier AS ticketIdentifier, t.title AS ticketTitle,
       wp.external_id AS key, wp.title, wp.metadata_json AS metadataJson, wp.url, wp.updated_at AS updatedAt
  FROM ticket_work_products wp JOIN tickets t ON t.id = wp.ticket_id
 WHERE wp.type = 'artifact' AND (?1 IS NULL OR t.project_id = ?1)
 ORDER BY wp.updated_at DESC
```

`kind` is read out of `metadata_json` the same way the ticket-page viewer already does
(`metadata['kind']`), not promoted to a column — no query or index need for it here either, consistent
with VS-269 design.md Decision 3's reasoning for not migrating it.

The route itself, `GET /api/w/:ws/knowledge/artifacts?project=`, is registered in
`packages/server/src/routes/knowledge.ts` next to `/docs` — not because the data is knowledge-owned (it
explicitly is not), but because this is where the document-explorer page's other reads already live,
and `?project=` optional (workspace-wide when omitted) matches every sibling route there
(`/docs?project=`, `/graph?project=`, `/health?project=`) rather than the mandatory-project-in-path
shape `/projects/:id/pull-requests` uses. `knowledge.ts`'s handler is a one-line delegate to
`c.get('ws').services.tickets.artifacts(project)` — no new service object, no blurring of ownership.

Rejected: a `packages/core/src/knowledge/*` method. That module owns `knowledge_files`/
`knowledge_links`/document content; reading ticket work products from inside it would be the same
category error the ticket's Out-of-scope list is guarding against, just one layer down in the code
instead of in the data model.

### 3. Query key: its own root, invalidated by `ticket.work_product`, not nested under `qk.knowledge`

`qk.artifactsRoot(ws)` / `qk.artifacts(ws, project)`, following the `pullRequestsRoot`/`historyRoot`
precedent (`keys.ts:94-106`) exactly: an artifact's staleness is driven by a ticket event
(`ticket.work_product`), and nesting the key under `qk.knowledge` would mean only knowledge-write events
(`knowledge.doc.*`, `knowledge.replaced`, etc. — none of which ever fire for an artifact) would
invalidate it, reproducing the VS-95/VS-97 bug from scratch. `events.ts`'s existing `ticket.work_product`
case (`events.ts:305-313`) gets one more `inv(qk.artifactsRoot(ws))` alongside its existing
invalidations — no new SSE event type, matching VS-269's own precedent of reusing tracked events rather
than adding one.

### 4. Viewer: extract the ticket page's iframe/toolbar into a shared component, reused verbatim

`TicketPage.tsx`'s `ArtifactsTab` (`:651-766`) already builds exactly what the explorer needs to render
a selected artifact: iframe pointed at the stored `url` (+ `?revision=`), a revision selector against
`useTicketDocumentRevisions(ticketId, \`artifact:${key}\`)`, and open/copy/download actions. That block
is extracted into a shared component (e.g. `components/ArtifactViewer.tsx`) parameterized on
`{ ws, ticketId, artifact, revisions }`; `ArtifactsTab` becomes a thin wrapper supplying its own
ticket's artifacts, and the explorer's new Artifacts panel supplies the selected row from the
project-wide list the same way. This is what makes "reusing VS-269's sandboxed viewing path rather than
a second rendering" true at the code level, not just true because the URL happens to match — one
component, one iframe, one CSP-serving route, two call sites.

Acceptance criterion 2 asks to assert the CSP "on the response the explorer actually loads, not the one
VS-269's tests already cover": the explorer-specific test fetches an artifact's `url` as returned by the
*new* `/knowledge/artifacts` listing (not a URL constructed by the test), through the same route, and
asserts the CSP header — proving the explorer's own request path lands on the real, unrelaxed route
rather than assuming it by construction.

## Risks / Trade-offs

- **[Risk]** A project with a very large number of artifacts could make a flat list unwieldy.
  **Mitigation**: out of scope for this ticket per its own framing (Phase 1); the list is a plain query
  with no pagination added, matching the current scale of hand-authored, agent-published artifacts. If
  volume grows, sorting/filtering is additive, not a data-model change (Decision 1).
- **[Risk]** A ticket with `project_id IS NULL` (allowed by the schema) would never appear under any
  project filter. **Mitigation**: matches how every other project-scoped knowledge read already treats
  a null-project ticket/document (excluded from a specific project, included when no project filter is
  set) — no special-casing needed, verified by test rather than assumed.

## Open Questions
(none)
