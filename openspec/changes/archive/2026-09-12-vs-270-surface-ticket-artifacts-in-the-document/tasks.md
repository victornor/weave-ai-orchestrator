## 1. Project-wide artifact read

- [x] 1.1 Add `artifacts(projectId: string | null)` to `packages/core/src/tickets/service.ts`, alongside
  `workProducts`/`documents`/`putArtifactWorkProduct`: the join query in design.md Decision 2, returning
  `{ id, ticketId, ticketIdentifier, ticketTitle, key, title, metadata, url, updatedAt }[]` sorted
  `updatedAt` descending (`metadata` is `metadata_json` parsed the same way `workProducts()`'s
  `camel()` mapping already exposes it — confirm the exact field name on read, do not assume `metadata`
  vs `metadataJson`, per the drift VS-269 design.md flagged for this same table). Verify a unit test
  publishes artifacts on two different tickets in the same project plus one on a ticket in a different
  project, and asserts the method returns only the two matching rows, each with the right
  `ticketIdentifier`, when called with that project's id, and all three when called with `null`.
- [x] 1.2 Verify by the same or a second unit test that a ticket with `project_id IS NULL` is excluded
  from every specific-project call and included in the `null` (no filter) call — design.md's stated
  risk, confirmed rather than assumed.
- [x] 1.3 Verify by test that republishing an artifact (same key, second `ac_ticket_artifact_put` call)
  still yields exactly one row for it in `artifacts()`, with the later `title`/`url`/`updatedAt`
  reflected — not a duplicate.

## 2. Route

- [x] 2.1 Add `GET /artifacts` to `packages/server/src/routes/knowledge.ts` (alongside `/docs`,
  `/graph`), reading the optional `project` query param the same way `/docs` and `/graph` already do,
  calling `c.get('ws').services.tickets.artifacts(project)`. Registered before `/:scope` for the same
  reason `/docs`/`/graph`/`/health` already are.
- [x] 2.2 Register `GET /w/:ws/knowledge/artifacts` in `packages/server/src/routetable.ts`
  (`auth: 'session'`, matching every other `/knowledge/*` entry) and document it in `docs/API.md` next
  to the other Knowledge & specs routes, stating the response shape and that `project` is optional.
  Verify a route-level test fetches it with and without `?project=` and asserts the filtered vs.
  unfiltered row sets.

## 3. Web app: types, keys, hooks, events

- [x] 3.1 Add a `TicketArtifactSummary` interface to `packages/ui/src/api/types.ts` matching 1.1's wire
  shape exactly (verify by reading the actual route response in a test, not by assuming the server
  field names).
- [x] 3.2 Add `artifactsRoot(ws)` and `artifacts(ws, project?)` to `packages/ui/src/api/keys.ts`,
  **not** nested under `qk.knowledge(ws)` — design.md Decision 3. Add a one-line comment there stating
  why, matching the existing `pullRequestsRoot`/`historyRoot` comments' style so a future reader does
  not repeat the VS-95/VS-97 mistake a third time.
- [x] 3.3 Add `useProjectArtifacts(project?: string)` to `packages/ui/src/api/hooks.ts`
  (`GET /knowledge/artifacts${qs({ project })}`, query key `qk.artifacts(ws, project)`), following
  `useKnowledgeDocs`'s existing shape.
- [x] 3.4 In `packages/ui/src/api/events.ts`'s `ticket.work_product` case, add
  `inv(qk.artifactsRoot(ws))` alongside the existing invalidations, with a comment stating this is what
  makes a publish appear in the explorer live. Verify by test: simulate a `ticket.work_product` event
  and assert `qk.artifactsRoot` is among the invalidated keys.

## 4. Shared artifact viewer component

- [x] 4.1 Extract `TicketPage.tsx`'s `ArtifactsTab` body (`:651-766` as read during design) into a new
  `packages/ui/src/components/ArtifactViewer.tsx`, parameterized on `{ ws, ticketId, artifact:
  { key, title, metadata, url }, revisions }` (props, not internal data-fetching) so it has no opinion
  on where its list of artifacts or its ticket id came from. It renders the iframe (unchanged sandbox
  attribute and CSP-serving `src`), the revision selector, and the open/copy/download actions
  (download's kit-inlining logic moves with it unchanged).
- [x] 4.2 Update `ArtifactsTab` in `TicketPage.tsx` to a thin wrapper: keep its own
  `useTicketWorkProducts`/`useTicketDocumentRevisions` calls and artifact-picker row list, and render
  `<ArtifactViewer>` for the selected artifact. Verify the existing `ticketpage.test.tsx` Artifact-tab
  tests still pass unchanged (no behavior change on the ticket page — this is a pure extraction).

## 5. Explorer UI

- [x] 5.1 Add an `ArtifactsSection` component (or equivalent) to `KnowledgeExplorer.tsx` (or a new
  sibling file if that keeps the existing file's size sane), rendering `useProjectArtifacts(project)`'s
  rows as a flat list — title, ticket badge (identifier, title on hover), kind (from `metadata['kind']`)
  when set, updated-at — sorted by `updatedAt` descending (already sorted server-side; do not re-sort
  client-side in a way that could drift from it). Selecting a row opens the artifact using
  `ArtifactViewer`, following the same open/close pattern as `openDoc`/`openHub`/`openArchive` in
  `KnowledgeExplorer`'s existing state.
- [x] 5.2 Render nothing (no Artifacts entry at all) when the list is empty — verify by test that a
  project with zero artifacts shows no Artifacts entry anywhere in the explorer, and that this does not
  affect the existing "Nothing to browse yet" empty state for a project with no documents either.
- [x] 5.3 Verify by test that an artifact from ticket A and one from ticket B both appear, each
  correctly attributed, and that opening one renders `ArtifactViewer` with that artifact's data.

## 6. Security posture verification (do not rely on VS-269's existing coverage)

- [x] 6.1 Add a test that lists artifacts through `GET /knowledge/artifacts`, takes the returned `url`
  for one of them, fetches it, and asserts the response carries the exact sandbox CSP string, `nosniff`,
  and `text/html` — proving the explorer's own read path lands on the real, unrelaxed serving route
  rather than assuming it because the URL string looks right (design.md's stated reason this must be a
  new assertion, not a reused one).

## 7. Checks

- [x] 7.1 `pnpm lint && pnpm typecheck && pnpm test` all green. Paste both `pnpm test` suite blocks
  verbatim (core/server suite and UI suite) with their real totals in the delivery report — never just
  one, never a retyped combined figure. Done: lint clean, typecheck clean, core/server suite 173 files
  | 1 skipped (174) / 2508 tests | 1 skipped (2509), UI suite 92 files (92) / 1521 tests (1521) — both
  green.
