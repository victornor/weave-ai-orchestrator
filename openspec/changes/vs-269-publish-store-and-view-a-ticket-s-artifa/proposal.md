## Why

VS-268 shipped the AC Artifact Kit, the `agent-conductor-artifacts` skill, and `ac_artifact_kit` — the
part of captain's artifacts specification that doesn't depend on where an artifact is stored. captain
has since settled that question: artifacts are ticket documents, browsable later from a ticket's own
page, never read back by another agent. This ticket builds the pipeline that decision unlocks: an
authoring tool, a safe serving route, the read-back closure, and the viewer — so an agent can publish
a self-contained HTML document and a human can see it, safely, from the ticket.

## What Changes

- Add `ac_ticket_artifact_put(id, key, html, { title?, kind? })`: validates a single HTML document
  under a size cap, stores it as a revisioned ticket document under an `artifact:<key>` key (a new
  guard extends `putDocument`'s existing reserved-key mechanism so only this tool can write that
  prefix), and upserts a `ticket_work_products` row (`type: 'artifact'`, `externalId: key`, `url`,
  `title`, `kind` in `metadataJson`) reusing the existing work-product machinery end to end. Returns
  the stable serve URL and the revision number.
- Close the read-back gap: `ac_ticket_document_get` (the only agent-facing document-read tool) refuses
  on an `artifact:`-prefixed key with an error explaining why and pointing at republishing instead of
  reading. Its `not_found` key-hint list also stops naming artifact keys. Ordinary
  `ac_ticket_document_put` is rejected on the same prefix, for the same reason `plan` already is —
  only `ac_ticket_artifact_put` may write there. Human-session HTTP/UI paths are unaffected: they
  never carried run-token auth in the first place.
- Add one new session-authenticated, ticket-scoped route, `GET
  /api/w/:ws/tickets/:id/artifacts/:key/raw[?revision=N]`, serving the stored HTML verbatim with the
  mandated sandboxed CSP, `nosniff`, and `text/html` headers. Registered in `routetable.ts` and
  `docs/API.md`.
- Add a small stable asset route, `GET /api/w/:ws/artifacts/kit.css`, serving `ARTIFACT_KIT_CSS`
  verbatim (`text/css`), so the web app's download action can inline the kit into a downloaded
  artifact without a second, drift-prone copy of the CSS reaching the browser bundle.
- Add an Artifact tab to `TicketPage.tsx`, shown only when the ticket has artifact work products: a
  sandboxed iframe, a list (title, kind, updated-at) sourced from the ticket's artifact work products,
  a revision selector reusing the existing document-revisions endpoint, and open-in-new-tab/copy-link/
  download actions. Download inlines the kit CSS (via the marker constants VS-268 already exports) so
  the file is standalone and network-free. Live refresh reuses the already-tracked `ticket.document`/
  `ticket.work_product` SSE events — no new event type.
- Fix `packages/ui/src/api/types.ts`'s `WorkProduct` interface, which has drifted from the actual wire
  shape (`ref`/`meta` do not exist on the wire; `title` exists but is untyped) — needed for the
  Artifact tab to read `title`/`metadataJson.kind` at all, and correct regardless.

## Capabilities

### New Capabilities
- `ticket-artifacts/storage`: `ac_ticket_artifact_put`'s validation and revisioning contract, the
  `artifact:` key-prefix reservation on `putDocument`, and the work-product upsert shape.
- `ticket-artifacts/read-back`: the closure — what an agent gets from `ac_ticket_document_get` and the
  document-list key hints when it names an `artifact:`-prefixed key.
- `ticket-artifacts/serving`: the raw HTML route, its exact response headers, and the kit CSS asset
  route.
- `ticket-artifacts/viewer`: the Artifact tab's presence condition, contents, and actions.

### Modified Capabilities
(none — `ticket-lifecycle` and `agent-tools` cover ticket transitions and other tool contracts, not
document/work-product behavior; nothing existing changes shape here beyond the new reserved prefix,
which is new behavior on a previously-unconstrained parameter, not a change to a stated requirement)

## Impact

- New: `packages/server/src/routes/tickets.ts` (raw serve route), a new artifacts asset route (exact
  file TBD in design — likely alongside `static.ts` or a new small route module), server-side artifact
  size/shape validation.
- Modified: `packages/core/src/tickets/service.ts` (`putDocument`'s reserved-key guard, a work-product
  upsert helper), `packages/shared/src/tools.ts` (new `ToolName`), `packages/server/src/tools.ts` (new
  `ToolDef`, and a guard added to the existing `ac_ticket_document_get`/`ac_ticket_document_put`
  handlers), `packages/server/src/routetable.ts`, `docs/API.md`, `packages/ui/src/routes/TicketPage.tsx`,
  `packages/ui/src/api/types.ts`, `packages/ui/src/api/hooks.ts` (a revision-list hook already exists
  and is reused; a new artifact-list read may be added).
- No DB migration: `ticket_documents`/`ticket_document_revisions` are already generic, and
  `ticket_work_products.type` already CHECK-allows `'artifact'` with `title`/`url`/`metadata_json`
  columns already present (confirmed against `packages/db/src/migrations`).
- Out of scope (per the ticket): the document explorer surface, a dedicated `ticket_artifacts` table,
  Mermaid, revision diffing, auto-drafted artifacts from PR diffs, any annotation/feedback rail.
