# Tasks

## 1. Server: mark artifact rows previewable

- [x] 1.1 In `packages/core/src/tickets/service.ts`, add `previewable` to the `artifacts(projectId)`
      query — an `EXISTS` against `ticket_documents` for `key = 'artifact:' || wp.external_id` on the
      same ticket, with `current_revision > 0` — and return it as a real boolean.
- [x] 1.2 Add a core test: an artifact row with a stored `artifact:<key>` document is `previewable:
      true`; a `type = 'artifact'` row with no stored document is `previewable: false` and still
      listed. Existing artifact-listing tests keep passing.

## 2. Server: reject `type: 'artifact'` at the general work-product tool

- [x] 2.1 In `packages/server/src/tools.ts`, make `weave_ticket_work_product`'s handler throw an
      `OcError` when `type === 'artifact'`, naming `weave_ticket_artifact_put` as the correct path;
      correct the tool description.
- [x] 2.2 Add a server test: `weave_ticket_work_product` with `type: 'artifact'` fails with that
      message and creates no work product; `weave_ticket_artifact_put` still records exactly one
      previewable artifact work product.

## 3. UI types and the Explorer list

- [x] 3.1 Add `previewable: boolean` to `TicketArtifactSummary` in `packages/ui/src/api/types.ts`.
- [x] 3.2 In `KnowledgeExplorer.tsx`, render only `previewable` artifact rows under Artifacts, and
      fold that filtered count into the "nothing to browse" empty-state condition.
- [x] 3.3 Update `knowledgeExplorer.test.tsx`: a link-only (non-previewable) row is not listed under
      Artifacts; a previewable row is.

## 4. Explorer panels lose their Close buttons

- [x] 4.1 In `KnowledgeDocs.tsx`, make `DocPanel`'s and `KnowledgeDocPanel`'s `onClose` optional and
      render the Close button only when it is supplied (`DocPanel`'s Delete uses `onClose?.()`).
- [x] 4.2 In `KnowledgeExplorer.tsx`, stop passing `onClose` to `DocPanel`/`KnowledgeDocPanel`, and
      remove the `onClose` prop and Close button outright from the private `ArchivePanel` and
      `ArtifactPanel`.
- [x] 4.3 Update the explorer test: no Close button in any desktop panel; the narrow-viewport
      `← tree` control still returns to the tree.

## 5. Viewer guard and download error

- [x] 5.1 In `ArtifactViewer.tsx`, when the URL is empty or is not a same-origin `/api/w/…/raw`
      serve path, render an explicit no-stored-content state, disable Open/Download, and mount no
      iframe.
- [x] 5.2 Surface a failed download as a visible error instead of swallowing it.
- [x] 5.3 Add component tests: an empty URL and a `file://` URL render the explicit state with no
      iframe and no enabled actions; a real `/api/w/…/raw` URL still renders the frame; a failed
      download fetch shows an error.

## 6. Ticket page Artifacts tab

- [x] 6.1 In `TicketPage.tsx`'s `ArtifactsTab`, split rows into previewable (backed by a
      `artifact:<externalId>` entry in the ticket's documents) and not; keep the viewer path for the
      former and render the latter as a plain link labelled with its URL, with no iframe and no
      Download.
- [x] 6.2 Update `ticketpage.test.tsx`: a work product with no stored artifact document renders as a
      plain link and mounts no iframe; the published-artifact tests keep passing.

## 7. Verify and report

- [x] 7.1 Run `pnpm lint`, `pnpm typecheck`, and the test suites; paste both suite blocks verbatim in
      the PR.
- [x] 7.2 Report the `ARTIFACT_CSP` finding (blocked inline scripts vs the `sandbox allow-scripts`
      intent and VS-269's serving spec) in the PR body; leave the CSP unchanged.
