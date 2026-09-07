## 1. The report's knowledge field

- [x] 1.1 In `packages/shared/src/report.ts`, replace `knowledgeUpdated: z.boolean().default(false)`
  with the required, refined `knowledge` object described in `design.md` (`recorded`, optional
  `where`/`reason`, refined so `where` is required when `recorded` is `true` and `reason` when it is
  `false`); update `RUN_REPORT_JSON_SCHEMA` to match with a plain object shape (`recorded` the only
  required key); verify with unit tests in a new or existing `report.test.ts`: a report missing
  `knowledge` entirely fails `RunReportSchema.safeParse`, one with `recorded: true` and no `where`
  fails, one with `recorded: false` and no `reason` fails, and both complete shapes succeed
- [x] 1.2 Verify `extractReport` returns `null` for each of the three failing shapes above (it
  already does once the schema rejects them; add the coverage at the `extractReport` level, not only
  `RunReportSchema.safeParse`, since that is the function the engine actually calls)
- [x] 1.3 Add an `engine.test.ts` case (next to the existing "records an empty turn when the agent
  produces no report" test) asserting that a report with every field valid except a `knowledge`
  object missing `where` for a `recorded: true` claim produces liveness `empty`, the same as no
  report at all
- [x] 1.4 Grep the repo for every other reference to `knowledgeUpdated` (templates, skills, docs,
  this repo's own `AGENTS.md`) and update each to the new shape's example JSON; there is no other
  code consumer of the old field to migrate

## 2. Templates and the plan

- [x] 2.1 In `templates/charter.md.tmpl`'s "Knowledge" line of the operating contract, state the
  note-vs-document distinction: a note for a short durable fact, a linked document
  (`ac_knowledge_doc_put`) for reasoning, a survey or a design rationale past a few sentences, and
  that a document must be linked from its hub file or another document to be found
- [x] 2.2 In `templates/worker.AGENTS.md.tmpl`, update the "Each turn" step that currently reads "consider
  one concise `ac_knowledge_note` ... or ... a linked document" to state the same distinction
  explicitly (not just "consider"), and update the worked final-report JSON example to the new
  `knowledge` field shape
- [x] 2.3 In `templates/conductor.AGENTS.md.tmpl`'s "Knowledge" section, add the same note-vs-document
  line, and update its final-report JSON example to the new `knowledge` field shape
- [x] 2.4 Update `docs/PLAN.md` §9.4's example report JSON to the new field, and add a short
  paragraph noting that a report missing the knowledge decision is treated as no report, the same as
  one missing `state`
- [x] 2.5 Add a short §13.7 to `docs/PLAN.md` (after §13.6) describing the health view's four
  measures, that they are derived rather than stored, the supervisor signal to the conductor, and
  that `knowledge_revisions` now carries the producing ticket
- [x] 2.6 Mark `docs/prompts/worker.AGENTS.md.tmpl` unchanged (it is already superseded and says so);
  do not edit it

## 3. Provenance

- [x] 3.1 Add migration `packages/db/src/migrations/0014_knowledge_provenance.sql`:
  `ALTER TABLE knowledge_revisions ADD COLUMN ticket_id TEXT REFERENCES tickets(id)`, nullable, no
  backfill; verify the migration runner applies it cleanly against a fresh database and against one
  seeded from the previous migration
- [x] 3.2 In `packages/core/src/knowledge/service.ts`'s `write()`, resolve `ticketId` from
  `actor.runId` (`SELECT ticket_id FROM runs WHERE id = ?`) when present, else `null`, and persist it
  on the `knowledge_revisions` insert; verify with a test that a note written by an actor carrying a
  `runId` whose run has a `ticketId` records that ticket, and that a human/system write with no
  `runId` records `null`
- [x] 3.3 Add `ticketId: string | null` and `ticketIdentifier: string | null` to the row shape
  `revisions()` returns (join `tickets.identifier`) and to `KnowledgeService.revisions()`'s type in
  `packages/core/src/api.ts`; verify with a test that `revisions()` on a file with both a
  ticket-attributed and a human-attributed revision reports each correctly
- [x] 3.4 Confirm `putDoc()`'s write path goes through the same `write()` (it does) so a document
  gets provenance with no separate change; add one test case for a document write to the suite added
  in 3.2 rather than duplicating the whole test

## 4. The health view

- [x] 4.1 In `packages/core/src/knowledge/files.ts`, add `export const DOCUMENT_STALE_MS = 90 *
  24 * 60 * 60 * 1000` next to `CURATION_BUDGET_FRACTION`, with the one-line rationale from
  `design.md` (90 days is a health signal, not a curation trigger)
- [x] 4.2 Add `KnowledgeService.health(projectId?: string | null)` to `packages/core/src/api.ts` with
  its return type (`hubs`, `orphans`, `stale`, `unresolvedLinks`, per `design.md`), and implement it
  in `service.ts` from `lint()`'s hub rows, `listDocs()`'s `backlinks`, `updatedAt` against
  `DOCUMENT_STALE_MS`, and `knowledge_links` rows with `to_path IS NULL`, scoped the same way
  `graph()` scopes visibility; verify with a test seeding one hub near budget, one orphan document,
  one document with an old `updatedAt`, and one unresolved link, asserting all four appear and that a
  clean project reports empty arrays, not omitted keys
- [x] 4.3 Add `GET /knowledge/health` to `packages/server/src/routes/knowledge.ts`, before `/:scope`
  (alongside `/docs` and `/graph`, for the same routing reason), accepting the existing `?project=`
  query param; verify with a server test that it answers the workspace view with no project and one
  project's view when scoped

## 5. The supervisor signal

- [x] 5.1 Add `knowledgeHealthPass()` to `packages/core/src/supervisor/index.ts`: for the workspace
  and for each project, compute `health(projectId)`, build the signature described in `design.md`
  (sorted orphan paths, unresolved `(from, slug)` pairs, stale doc paths, near-budget hub paths),
  compare it against `meta['supervisor:knowledge_health:<scope>']`, and wake the conductor
  (`reason: 'knowledge_health'`, payload capped to 10 entries per measure) when the signature grew or
  the total issue count reaches 5, subject to the existing `CURATION_REQUEST_COOLDOWN_MS` per scope;
  always persist the new signature. Call it from `tick()` on its own `due()` interval
  (`KNOWLEDGE_HEALTH_EVERY_MS`, 30 minutes), next to `curationPass`
- [x] 5.2 Seed the signature with no wake on the first sweep of a scope (a `meta` key that has never
  been set means "record, don't compare"); verify with a test that a project with an existing orphan
  on its first sweep is recorded but does not wake the conductor
- [x] 5.3 Verify with tests: a new orphan appearing between two sweeps wakes the conductor; a hub
  crossing 80% between two sweeps wakes the conductor with no write having been rejected; an
  unchanged signature does not wake it; a fixed orphan drops out of the next signature and does not
  wake it either; the per-scope cooldown prevents a second wake inside its window even if the
  signature keeps growing
- [x] 5.4 Extend whichever core test harness proxies `CoreServices` needs it (`testing/context.ts`,
  `server/test/fakes.ts`) only if `knowledgeHealthPass` needs a service member neither already
  supplies (it should not — `health()` lives on the existing `knowledge` service member); confirm by
  running the full core and server suites, not by assuming

## 6. The web app

- [x] 6.1 Add `useKnowledgeHealth(projectId?)` hook, `qk.knowledgeHealth` in `api/keys.ts`, its
  response type in `api/types.ts`, and map `knowledge.updated` / `knowledge.curated` to it in
  `api/events.ts`; verify with a test over `invalidateFor` that a knowledge event invalidates the key
- [x] 6.2 Extend `KnowledgeSection.tsx` on the project overview (or add a sibling section, whichever
  reads cleaner once 6.1 lands) to show orphan count, stale count and unresolved-link count, each
  linking into `/w/$ws/knowledge` scoped to the project and, where the destination supports it, to
  the specific document; render "none" plainly for a clean project rather than omitting the block;
  verify with a jsdom test using a fixture health response
- [x] 6.3 In `Knowledge.tsx`'s revision list (`KnowledgeDocPanel`, the block rendering
  `revisions.data`), show the `ticketIdentifier` from task 3.3 as a link when present, alongside the
  existing reason and timestamp; verify with a test that a revision carrying a ticket renders its
  link and one with none renders without it
- [x] 6.4 Confirm the existing `PROJECT_SECTIONS` pinning test (if one exists, per the pattern noted
  in the VS-97 change) still passes unchanged — this task adds content to an existing section, not a
  new one, so the section list itself does not move

## 7. Green

- [x] 7.1 Run `pnpm typecheck` (the full chained command, not the ui filter alone), `pnpm lint`,
  `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run`, and verify all four are green
- [x] 7.2 Re-read the final report's own `knowledge` field on this ticket's merge turn as a sanity
  check that the new shape is followable in practice, not only in tests
