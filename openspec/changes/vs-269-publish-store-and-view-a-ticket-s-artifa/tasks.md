## 1. Storage: `ac_ticket_artifact_put`

- [x] 1.1 Extend `putDocument`'s reserved-key guard in `packages/core/src/tickets/service.ts:447-449`
  so a key starting with `artifact:` is also rejected unless the internal-only flag is set (reuse
  `opts.system` or add a sibling flag — match the existing `plan` guard's shape and error style).
  Verify a unit test calls `putDocument` directly with an `artifact:`-prefixed key and no internal flag
  and asserts it throws `forbidden`. Done: guard added; `tickets.test.ts` "refuses an external write to
  an artifact:-prefixed key".
- [x] 1.2 Add `putArtifactWorkProduct(actor, ticketId, key, { url, title, kind, revision })` to
  `packages/core/src/tickets/service.ts`: look up an existing `ticket_work_products` row by
  `ticket_id + type='artifact' + external_id=key`; update `url`/`title`/`updated_at` and
  `metadata_json.kind` in place if found, otherwise call `addWorkProduct` with `type: 'artifact'`,
  `externalId: key`. Verify a unit test publishes twice under the same key and asserts exactly one
  `ticket_work_products` row exists afterward, with the second call's `url`/`title` reflected. Done:
  note the wire field the DB layer maps `metadata_json` back to is `metadata`, not `metadataJson` (the
  `_json` suffix is dropped on read, per `packages/db/src/db.ts`'s `camel()`) — corrected in 4.1 below.
- [x] 1.3 Add the HTML-shape and size-cap validation used by the new tool: reject an empty body, a
  body with no recognizable HTML document markers (case-insensitive `<html`), and a body over
  2,000,000 characters, each with a distinct, named validation error. Verify unit tests cover all
  three rejection cases and one accepted case. Done: `validateArtifactHtml` in `tools.ts`; covered by
  `integration.test.ts` "rejects an empty body, a non-HTML body, and an oversized body".
- [x] 1.4 Add `ac_ticket_artifact_put` to `COMMON_TOOLS` in `packages/shared/src/tools.ts`. Verify
  `pnpm typecheck` passes. Done.
- [x] 1.5 Add the `ToolDef` in `packages/server/src/tools.ts`: `scope: 'all'`, input
  `{ id: ticketId, key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), html: z.string(), title:
  z.string().max(200).optional(), kind: z.string().max(40).optional() }`, using `writeTicket` (per the
  `ac_ticket_document_put`/`ac_ticket_work_product` pattern at `tools.ts:320-350`). The handler runs
  the 1.3 validation, calls `putDocument(..., \`artifact:${key}\`, html, { system: true })` then
  `putArtifactWorkProduct(...)`, and returns `{ url, revision }` where `url` is the raw-serve path
  (`/api/w/{ws}/tickets/{id}/artifacts/{key}/raw`). The tool's `description` states plainly that there
  is no matching read tool and that revising an artifact means calling this again under the same key,
  never reading it back first. Verify a test in `packages/server/test` (following the existing
  `ac_ticket_document_put`/`ac_artifact_kit` test patterns) publishes an artifact via MCP and asserts
  the returned `url`/`revision` shape and that a matching `ticket_work_products` row of type
  `artifact` now exists. Done: tested via the real-services agent-tools path in `integration.test.ts`
  (MCP's own harness is a hand-rolled fake with no document/work-product parity — real-services HTTP
  is the honest path here) — "publishes an artifact and it shows up as a work product with a stable URL".

## 2. Read-back closure

- [x] 2.1 In `ac_ticket_document_get`'s handler (`packages/server/src/tools.ts:325-337`), before
  calling `getDocument`, check whether the requested key starts with `artifact:`; if so throw
  `forbidden` with a message stating artifact bodies are not readable by agents and naming
  `ac_ticket_artifact_put` as the path to revise one. Verify a test calls `ac_ticket_document_get` for
  a key that was published via `ac_ticket_artifact_put` in the same test and asserts a `forbidden`
  error containing that guidance, never the HTML body. Done.
- [x] 2.2 In the same handler's `not_found` path (`tools.ts:332-333`), filter `artifact:`-prefixed
  keys out of the `availableKeys` hint array before returning it. Verify a test publishes an artifact
  and a plain document on the same ticket, requests a third, nonexistent key, and asserts
  `availableKeys` contains the plain document's key but not the artifact's. Done.
- [x] 2.3 Add the same `artifact:`-prefix rejection to `ac_ticket_document_put`'s handler (or confirm
  task 1.1's `putDocument` guard alone already surfaces as a clean tool-level error with no other
  handler change needed — verify by testing this call path specifically, don't assume it inherits the
  same message quality as 1.1's direct-service test). Done: confirmed the service-layer guard alone
  surfaces cleanly through the tool with no handler change needed — `integration.test.ts` "Writing an
  artifact-shaped key through the general document tool is refused too".

## 3. Serving

- [x] 3.1 Add `GET /api/w/:ws/tickets/:id/artifacts/:key/raw` (optional `?revision=N`) in
  `packages/server/src/routes/tickets.ts`: call `requireOperator(c)` first, then
  `getDocument(id, \`artifact:${key}\`, revision)`, returning 404 JSON on a missing document, or the
  body via `c.text(body, 200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options':
  'nosniff', 'content-security-policy': "sandbox allow-scripts allow-forms allow-popups
  allow-downloads; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src data: 'self';
  font-src data:; connect-src 'none'" })`. Verify a test fetches a published artifact's raw URL over
  HTTP and asserts the response body matches the stored bytes exactly and every required header is
  present with the exact CSP string. Done.
- [x] 3.2 Verify by test that the raw route rejects a request authenticated only with a run-token
  bearer credential (the agent path), confirming the `/tickets/**` exclusion from `RUN_TOKEN_PATHS`
  plus the added `requireOperator(c)` call both hold for this specific route. Done: 403.
- [x] 3.3 Verify by test that requesting an explicit earlier `?revision=N` after a second publish to
  the same key returns the earlier revision's exact bytes, not the current ones. Done.
- [x] 3.4 Add `GET /api/w/:ws/artifacts/kit.css` returning `ARTIFACT_KIT_CSS` (from
  `@agent-conductor/core`) verbatim as `text/css`, session-authenticated like the ticket routes.
  Verify a test fetches it and asserts the body equals `ARTIFACT_KIT_CSS` exactly and the content-type
  is `text/css`. Done: new `packages/server/src/routes/artifacts.ts`, mounted at `/artifacts`.
- [x] 3.5 Register both new routes in `packages/server/src/routetable.ts`'s `ROUTES` array
  (`auth: 'session'`) and document both in `docs/API.md` in the same style as the existing ticket
  document routes. Done.

## 4. Viewer

- [x] 4.1 Fix `packages/ui/src/api/types.ts`'s `WorkProduct` interface to match the real wire shape
  from `workProducts()`/`GET /tickets/:id/work-products`: remove `ref`/`meta`, add `title: string |
  null` and `metadata: Record<string, unknown>` (the DB layer's `camel()` drops the `_json` suffix
  entirely on read, so the wire field is `metadata`, not `metadataJson` — confirmed in 1.2's test; plus
  any other real field the route returns that the current type omits). Verify `pnpm typecheck` passes
  and any existing code reading the old `ref`/`meta` fields is updated to the corrected shape. Done:
  `WorkTab`'s row (`TicketPage.tsx`) updated to `p.title ?? p.externalId ?? p.url`.
- [x] 4.2 Add an `artifacts` entry to `TABS` in `packages/ui/src/routes/TicketPage.tsx:46-53`, shown
  only when `useTicketWorkProducts(ticketId)` contains at least one `type === 'artifact'` entry.
  Verify by manual check (dev server or the project's screenshot harness) that the tab is absent on a
  ticket with no artifacts and appears once one is published, without a page reload (relying on the
  already-tracked `ticket.work_product` SSE event). Done via component test instead of a manual/dev-
  server check (no live daemon available in this worker; jsdom render + the existing `ticket.document`/
  `ticket.work_product` SSE-invalidation plumbing already covers the live-refresh path, unchanged by
  this ticket) — `ticketpage.test.tsx` "shows no Artifacts tab..." / "shows the Artifacts tab once...".
- [x] 4.3 Build the `ArtifactsTab` component: a list (title or key fallback, `metadata.kind`,
  `updatedAt`) from the filtered work products; selecting an entry renders a
  `<iframe sandbox="allow-scripts allow-forms allow-popups allow-downloads">` pointed at that
  artifact's raw URL; a revision selector using `useTicketDocumentRevisions(id,
  \`artifact:${key}\`)` (existing hook, reused unchanged) that updates the iframe `src`'s `?revision=`
  query param. Verify by manual check that selecting a prior revision changes the rendered content.
  Done, tested via jsdom component tests (see 4.2's note on why not a live manual check).
- [x] 4.4 Add Open-in-new-tab and Copy-link actions using the artifact's raw URL resolved against
  `window.location.origin`. Verify manually that both work as expected. Done: copy-link guards on
  `navigator.clipboard.writeText` existing (jsdom/insecure-context safe, matching `Markdown.tsx`'s
  existing `clipboardAvailable()` pattern) — component-tested; the actual OS clipboard write is
  unverifiable in this environment per the project's own VS-139 finding, same as every other
  clipboard feature here.
- [x] 4.5 Add the Download action: fetch the artifact's raw HTML and (if the response lacks
  `ARTIFACT_KIT_MARKERS`, fetched/checked via `GET /api/w/:ws/artifacts/kit.css`'s content or a
  lightweight marker check against the HTML text) inject a `<style>` block with that CSS before
  `</head>`, then trigger a browser download of the resulting file. Verify manually: download an
  artifact whose HTML does not embed the kit, open the downloaded file from disk with network access
  disabled, and confirm it renders with AC styling; separately confirm an artifact that already embeds
  the kit downloads byte-identical to its raw HTML (no doubled `<style>` block). Done, with one
  deliberate deviation from the plan: `ARTIFACT_KIT_MARKERS` turned out to be CSS *region* markers
  internal to the drift test (e.g. `[data-theme='dark'] {`), not a fingerprint that an artifact
  embeds the kit — reusing them would false-positive on any unrelated document using that selector.
  Instead the download handler fetches the kit CSS text (already needed to inline it) and checks
  `html.includes(kitCssText)` — an exact, correct containment check with no extra surface. Component-
  tested (`ticketpage.test.tsx` "downloads without throwing..."); the actual file-from-disk render is
  unverifiable without a browser in this worker environment, stated here as unverified per the
  project's screenshot-harness convention.

## 5. Checks

- [x] 5.1 `pnpm lint && pnpm typecheck && pnpm test` all green. Paste both `pnpm test` suite blocks
  verbatim (core/server suite and UI suite) with their real totals in the delivery report — never
  just one, never a retyped combined figure. Done: lint clean, typecheck clean, core/server suite
  173 files | 1 skipped (174) / 2495 tests | 1 skipped (2496), UI suite 92 files (92) / 1513 tests
  (1513) — both green.
