## Why

A pre-VS-269 `ticket_work_products` row of `type = 'artifact'` was recorded with an arbitrary
`file://` URL and no stored `artifact:<key>` document. Both the Knowledge Explorer and the ticket
page feed such a row into `ArtifactViewer`, which then renders a blank iframe and dead Download/Open
actions — the browser refuses `file://` inside an http page, and the download fetch strips the API
prefix from a URL that never had it. The general work-product tool still accepts `type: 'artifact'`,
so this recurs.

## What Changes

- **Only published artifacts open in the viewer.** The Explorer's Artifacts list shows only artifact
  work products backed by a stored `artifact:<key>` document; a link-only row is omitted. The ticket
  page's Artifacts tab renders a non-published artifact as a plain work-product link (its URL shown
  as text, no iframe, no Download) instead of feeding it to the viewer.
- **The viewer refuses to fake a preview.** When `ArtifactViewer` receives an empty URL or one that
  is not an `/api/w/…/raw` serve path, it renders an explicit "no stored content to preview" state
  with Download and Open disabled, instead of a blank iframe and dead buttons.
- **Download failures are visible.** The download action surfaces its error to the user rather than
  swallowing it.
- **Link-only artifacts can no longer be recorded.** `weave_ticket_work_product` with
  `type: 'artifact'` is rejected with a message naming `weave_ticket_artifact_put` as the correct
  path.
- **The Explorer loses its Close buttons.** `DocPanel`, `KnowledgeDocPanel`, `ArchivePanel` and
  `ArtifactPanel` no longer render Close inside the Explorer; the phone `← tree` control is kept. The
  shared panels keep a working Close where they are reused outside the Explorer.
- **CSP finding reported, not changed.** `ARTIFACT_CSP` sets `default-src 'none'` with no
  `script-src`, so an artifact's own inline scripts are blocked even though the `sandbox` directive
  and VS-269's serving spec both presume they run. This is recorded in the PR as a finding; the CSP
  is left as captain specified it.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `ticket-artifacts/explorer`: the Artifacts entry lists only artifacts backed by a stored artifact document, so a link-only work product never appears.
- `ticket-artifacts/viewer`: the viewer has an explicit no-stored-content state and never renders a blank frame or dead actions; the ticket page shows a non-published artifact as a plain work-product link.
- `ticket-artifacts/storage`: the general work-product tool rejects `type: 'artifact'` and points at the artifact-publishing tool.
- `knowledge/document-explorer`: the explorer's content panels drop the desktop Close control while the narrow-viewport back-to-tree control remains.

## Impact

- `packages/core/src/tickets/service.ts` (`artifacts()` gains `previewable`), `packages/server/src/tools.ts`
  (`weave_ticket_work_product` rejects `artifact`), `packages/ui/src/api/types.ts`,
  `packages/ui/src/components/ArtifactViewer.tsx`,
  `packages/ui/src/routes/KnowledgeExplorer.tsx`, `packages/ui/src/routes/TicketPage.tsx`,
  `packages/ui/src/routes/KnowledgeDocs.tsx`.
- Tests: core artifact-listing test, server work-product tool test, UI viewer/explorer/ticket-page tests.
- No database migration and no API route added or removed. `Weave AI` and existing VS-68 row remain readable.
