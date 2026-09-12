## Why

VS-269 gave every ticket a place to publish and view an artifact, but only that ticket knows the
artifact exists — a human has to already be looking at the right ticket to find it. captain settled
where artifacts live (ticket documents, never moved) and settled what matters instead: they are
"browsable alongside the other documents in the knowledge base." VS-265 just built that browsing
surface. This ticket connects the two: an Artifacts entry in the document explorer that lists every
artifact across the project's tickets, without moving a single byte or granting artifacts any
knowledge-document identity (no slug, no `[[link]]`, no graph node).

## What Changes

- Add a project-wide artifact listing: every `type: 'artifact'` work product across the project's
  tickets, each carrying its ticket's identifier/title, its own title/kind/updated-at, and the same
  raw-serve URL VS-269 already produces. Exposed as `GET /api/w/:ws/knowledge/artifacts?project=`
  (optional `project`, matching every other `/knowledge/*` read), backed by a new tickets-service
  method — kept there, not in the knowledge service, since the data is ticket-owned and this is a
  second read surface over it, not a new kind of knowledge content.
- Add an **Artifacts** entry to the document explorer's tree (`KnowledgeExplorer.tsx`), rendered as a
  flat list sorted most-recently-updated first, each row showing its title, a ticket badge (identifier
  + title), kind (when the publisher set one) and updated-at. **Flat, not grouped by ticket or kind** —
  see design.md Decision 1 for why. The entry is omitted entirely when the current scope has no
  artifacts (no empty/broken folder).
- Opening an artifact reuses the exact stored raw-serve URL and the existing revision-picker endpoint —
  no second rendering path, no relaxed CSP. The iframe/toolbar/actions block already built for the
  ticket page's Artifact tab is extracted into a shared component so the explorer and the ticket page
  render the identical thing from the identical route.
- Wire the existing `ticket.work_product` SSE event (already tracked, already fired on publish) to
  invalidate the new listing's query key, so a newly published artifact appears in the explorer without
  a reload. The query key is its own root, not nested under `qk.knowledge`, matching the project's own
  established rule for `qk.pullRequestsRoot`/`qk.historyRoot`: an artifact publish is a ticket event,
  not a knowledge-write event, and nesting it under a key only knowledge events invalidate would leave
  it stale the same way those two were before VS-95/VS-97.

## Capabilities

### New Capabilities
- `ticket-artifacts/explorer`: the project-wide artifact listing, the Artifacts entry's presence and
  grouping in the document explorer, its empty-project behavior, and that opening an entry reuses the
  existing sandboxed viewing path unchanged.

### Modified Capabilities
(none — `knowledge/document-explorer`'s existing requirements describe the document/hub folder tree
specifically; artifacts are explicitly not knowledge documents and do not belong in that tree model, so
nothing stated there changes. `ticket-artifacts/viewer`'s requirements describe the ticket page's own
Artifact tab, which is unchanged by this ticket — the component it renders is reused, not its contract.)

## Impact

- New: a tickets-service method reading `ticket_work_products` (`type='artifact'`) joined with
  `tickets` for identifier/title, scoped by optional `project_id`; a route in
  `packages/server/src/routes/knowledge.ts`; `routetable.ts` and `docs/API.md` entries.
- Modified: `packages/ui/src/routes/KnowledgeExplorer.tsx` (new Artifacts section), a new shared
  viewer component factored out of `packages/ui/src/routes/TicketPage.tsx`'s `ArtifactsTab` (used by
  both), `packages/ui/src/api/keys.ts` (new query keys), `packages/ui/src/api/events.ts` (new
  invalidation on `ticket.work_product`), `packages/ui/src/api/hooks.ts` (new list hook),
  `packages/ui/src/api/types.ts` (new summary type).
- No DB migration: reads existing `ticket_work_products`/`tickets` columns only.
- Out of scope (per the ticket): moving artifacts into knowledge storage or giving them slug/link/graph
  identity, editing/annotating/deleting from the explorer, any change to VS-269's authoring tool or
  serve route.
