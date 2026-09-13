## Context

`ticket_work_products` has held `type = 'artifact'` rows since before the VS-269 publishing
pipeline existed. The one live example is VS-68's: a `file:///…/artifacts/` URL and no
`artifact:<key>` document. Every surface that treats "artifact work product" as "published artifact"
then hands that URL to `ArtifactViewer`, which builds a blank iframe and dead Open/Download actions.
Two independent things are wrong: the surfaces use the row type as the publication signal, and the
viewer trusts whatever URL it is handed.

VS-269 already established the real signal: a published artifact is a stored `artifact:<key>` ticket
document *plus* the work-product row the publishing tool writes. `weave_ticket_artifact_put` always
writes both; `weave_ticket_work_product` writes neither the document nor a serve path. That is the
seam this change closes.

Goals: a link-only row can no longer blank the explorer or the ticket page; it can no longer be
created; the explorer loses its desktop Close buttons. Non-goals: changing the artifact serving
route, its CSP, or the database schema.

## Decisions

### 1. "Previewable" is the presence of the stored artifact document, checked server-side

The criterion is what VS-269 made true of a publication, not a guess about the URL. A row is
previewable iff a `ticket_documents` row exists with `key = 'artifact:' || external_id` for the same
ticket (the `current_revision > 0` documents the rest of the API treats as live). A URL-shaped check
would call a row previewable whose URL ends `/raw` but whose document was never stored, and would
still mount a frame that 404s.

### 2. The project-wide list gains a `previewable` flag; the explorer filters it

`tickets.artifacts(projectId)` gains `previewable` (an `EXISTS` subquery against `ticket_documents`)
and keeps returning every artifact row. The explorer's `ArtifactsSection` renders only the
previewable rows, and its empty/nothing-to-browse checks count only those. Rejected: filtering the
rows out in the service. The flag keeps the classification observable (and directly testable), keeps
the existing project/list contract intact, and leaves the ticket page and the explorer able to agree
on the same concept rather than one silently dropping rows the other still sees.

### 3. The ticket page derives previewability from the ticket's own document list

`ArtifactsTab` already fetches `useTicketWorkProducts`; it additionally reads the ticket detail's
`documents` (already fetched by the page, and refreshed live because `weave_ticket_artifact_put`'s
`putDocument` emits `ticket.document`, which invalidates `qk.ticket`). An artifact row is previewable
when `documents` contains `artifact:<externalId>`. Previewable rows keep the current list-plus-viewer
behaviour; a non-previewable row renders as a plain work-product line showing its URL, with no
iframe and no Download. No new route or field is needed for this surface.

### 4. The viewer's own guard is URL-shaped, and last

Independently of the flag, `ArtifactViewer` checks that its URL is a same-origin `/api/w/…/raw` serve
path (path component ends in `/raw`, before any `?revision=`). Empty or non-conforming URLs render an
explicit no-stored-content state with Download and Open disabled and no iframe. This is the belt to
the list's braces: any future caller that passes a bad row can no longer produce a blank frame. A
conforming URL keeps rendering exactly as today, so no published artifact changes behaviour.

### 5. Download errors are surfaced

The current `download()` has no `catch`; a failed fetch leaves the button state to the `finally` and
shows nothing. Add an error state rendered near the actions, cleared on the next attempt. The
existing success path (inline the kit CSS if absent, blob-download) is unchanged.

### 6. Reject `type: 'artifact'` at the general work-product tool

Chosen over "store it where the viewer ignores it": rejecting is smaller and it removes the class of
row rather than teaching every consumer to distrust a row type. The tool handler throws an `OcError`
naming `weave_ticket_artifact_put` as the correct path; the tool description is corrected to match.
The `WORK_PRODUCT_TYPES` enum and the database CHECK constraint keep `artifact`, because
`putArtifactWorkProduct` — the publishing tool's own writer — still needs the type. Existing rows are
untouched; decisions 1–3 are what stop them from breaking the UI.

### 7. Shared panels take an optional close handler

`DocPanel` and `KnowledgeDocPanel` are reused by the non-explorer Knowledge page (`Knowledge.tsx`,
`DocsPanel`), where Close is still the control that dismisses the open document. They make `onClose`
optional and render Close only when it is supplied. The explorer stops supplying it. `ArchivePanel`
and `ArtifactPanel` are private to the explorer, so their close prop and button are removed outright.
`DocPanel`'s Delete calls `onClose?.()`; inside the explorer that now leaves the panel showing its
"does not exist yet" state rather than clearing the selection — acceptable, and no worse than the
user re-selecting from the tree. The narrow-viewport `← tree` control is a separate button on
`clearSelection` and is untouched.

### 8. CSP finding — reported, not changed

`ARTIFACT_CSP` is `sandbox allow-scripts …; default-src 'none'; …` with no `script-src`. Because
`script-src` falls back to `default-src 'none'`, an artifact's inline scripts are blocked: the
`sandbox` directive permits scripts but the CSP forbids them. VS-269's viewing spec scenario ("a
served artifact's own script executes and attempts to read `document.cookie`") and the `sandbox
allow-scripts` choice presume they run, so the two are inconsistent. The CSP string is captain's
specification and the ticket says not to change it without a stated reason, so this is reported in
the PR as an unverified-against-intent finding and left alone. Fixing it (adding
`script-src 'unsafe-inline'`) is a separate decision.

## Risks

- A `previewable` flag reaches an API also read by the CLI/TUI. Additive and optional, so no
  consumer breaks; the UI type gains the field.
- The explorer currently shows an "Artifacts" section whenever any artifact row exists. After the
  change a scope whose only rows are link-only shows no section — that is the intended reading of
  "no Artifacts entry for a project with none", not a regression.
- The ticket-page split must not double-lend an artifact to both the viewer list and the plain-link
  list; one partition over the same filtered rows avoids that.
