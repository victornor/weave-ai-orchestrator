## 1. Data model

- [x] 1.1 Add migration `packages/db/src/migrations/0015_knowledge_usage.sql` creating
      `knowledge_usage_events` with the columns, `CHECK`s and the `knowledge_usage_dedupe` unique
      index from design.md, plus the `ws_time`/`project_time`/`ticket` indexes; verify
      `pnpm --filter @agent-conductor/db test` (or the repo's migration test) picks it up cleanly on
      a fresh database. (No FK on `run_id`, matching `usage_events`' own precedent — neither table's
      writers or tests have a real `runs` row to point at.)
- [x] 1.2 Add the row/type mapping for `knowledge_usage_events` wherever `packages/db` maps other
      snake_case tables to camelCase rows (follow the existing pattern for `usage_events`); verify a
      unit test round-trips an insert and read. (Handled by `Db`'s generic camel/snake mapper —
      confirmed via the `knowledge-usage.test.ts` round-trip; no new db-layer file needed.)

## 2. Recording — bootstrap

- [x] 2.1 Change `KnowledgeService.bootstrapDigest` (`packages/core/src/knowledge/service.ts`) to
      also return `parts: { scope, projectId, tokens }[]`, measuring each chunk's tokens with
      `estimateTokens` at the point it is built (before the join/truncate), for both the conductor
      and worker branches; verify a unit test asserts `parts` for a conductor digest with two
      projects has one entry per project with the chunk's own token count, not the file's
      `tokenEstimate`.
- [x] 2.2 Add `packages/core/src/knowledge/usage.ts` implementing `KnowledgeUsageService` per
      design.md (`recordBootstrap`, `recordRead`, `forRun`, `forTicket`, `summary`, `topDocuments`,
      `neverRead`), backed by `knowledge_usage_events`; wire it into `CoreServices` in
      `packages/core/src/api.ts` and the workspace context that builds `CoreServices`; verify
      `packages/core/src/testing/context.ts` and `packages/server/test/fakes.ts` both supply it (per
      the CoreServices landmine) and the existing test suites still pass.
- [x] 2.3 Thread `runId` into `TurnPromptOptions` and set it in `engine.ts` right before the
      `buildTurnPrompt` call; inside `buildTurnPrompt`, after computing the digest, call
      `deps().knowledgeUsage.recordBootstrap(...)` inside the existing try/catch around the digest
      call; verify an engine test spawning a turn asserts `knowledge_usage_events` rows with
      `kind = 'hub'` matching the digest's `parts`. (The recording call is further isolated in its
      own inner try/catch so a recording failure can never wipe out a digest that built fine.)

## 3. Recording — explicit reads

- [x] 3.1 In `packages/server/src/tools.ts`, after `ac_knowledge_get`'s handler returns successfully,
      call `svc(ctx).knowledgeUsage.recordRead(...)` with `kind: 'document'`, `slug: null`, and the
      result's `tokenEstimate`, wrapped so a recording failure cannot turn the tool call into an
      error; verify a tools test asserts a `knowledge_usage_events` row after the call.
- [x] 3.2 Do the same for `ac_knowledge_doc_get`, passing the read slug and its `tokenEstimate`;
      verify a tools test asserts calling it twice in the same run (same `runId`, `scope`, `slug`)
      leaves exactly one row, at the first call's token count.
- [x] 3.3 Verify a tools test calling `ac_knowledge_get` on a scope already recorded as `kind: 'hub'`
      for the same run produces both a `hub` row and a separate `document` row for that scope (the
      "explicit hub read is recorded as a read, not folded into bootstrap" scenario).

## 4. Rollups and routes

- [x] 4.1 Implement `forTicket` reusing the subtree CTE pattern from `UsageService.ticket()`
      (`packages/core/src/usage/service.ts`) so a parent ticket's knowledge context includes its
      children's; verify a unit test with a ticket and a child ticket, each with runs that read
      different documents, sums correctly and returns the union of documents.
- [x] 4.2 Implement `summary`, `topDocuments` and `neverRead` per design.md, reusing
      `resolveUsageWindow` for window handling and `KnowledgeService.listDocs` for the document
      catalogue `neverRead` starts from; verify unit tests for: a document read by several runs
      ranks above one read by one run; a document that exists in the catalogue but has zero matching
      rows in the window appears in `neverRead`; a document read outside the window but not inside
      it also appears in `neverRead`. (`topDocuments`/`neverRead` group by the document's own
      project, not the reading run's, so a project's "most/never read" reflects that project's
      documents regardless of who read them; `summary`'s "per run" figure stays scoped to the run's
      own project, matching `usage_events`' convention.)
- [x] 4.3 Add `GET /tickets/:id/knowledge-usage` and the `/knowledge/usage/summary|top|never-read`
      routes (the latter three on `knowledgeRoutes()`, registered before `/:scope` per the Hono
      ordering landmine) and the corresponding service interfaces in `packages/core/src/api.ts`;
      verify a server route test for each endpoint and that `docs/API.md` documents them (per the
      repo's checklist for new routes).

## 5. Web UI

- [x] 5.1 Add `qk.ticketKnowledgeUsage`, `qk.knowledgeUsageRoot`, `qk.knowledgeUsageTop`,
      `qk.knowledgeUsageNeverRead` to `packages/ui/src/api/keys.ts` and the corresponding hooks
      (`useTicketKnowledgeUsage`, `useKnowledgeUsageSummary`, `useKnowledgeUsageTop`,
      `useKnowledgeUsageNeverRead`) to `packages/ui/src/api/hooks.ts`; verify a hooks/route test
      renders with the mocked data.
- [x] 5.2 Emit `knowledge_usage.recorded` (workspace event) from `recordBootstrap`/`recordRead`,
      carrying `ticketId` when there is one; wire it in `packages/ui/src/api/events.ts` to invalidate
      both `qk.knowledgeUsageRoot(ws)` and, when present, `qk.ticketKnowledgeUsage(ws, ticketId)`;
      verify an events test asserts both invalidations fire.
- [x] 5.3 Add a `knowledge` tab to `TicketPage.tsx` next to `usage`, rendering hub/document/total
      stat tiles, the document list, and the one-line "knowledge context, not total context, measured
      from what was sent/returned" statement; verify a component test renders it with mocked data
      and the existing `usage` tab test still passes (per the route-test-mocks-hooks-wholesale
      landmine, update every `TicketPage` test's `../api/hooks` mock).
- [x] 5.4 Add a "Knowledge context" section to `Usage.tsx` (average-tokens-per-run stat tile,
      `RankedBars` for top documents, a plain never-read list). This page has no project selector
      (only a per-project breakdown of the token/cost charts), so the section is workspace-wide
      rather than scoped to the page's absent project picker, reusing only its `window` (falling
      back to `all` for `custom`, which the knowledge routes don't support); verify a component test
      renders it and the existing `Usage.tsx` tests still pass.

## 6. Verification and documentation

- [x] 6.1 Run `pnpm lint && pnpm typecheck && pnpm test` (root, plus
      `pnpm --filter @agent-conductor/ui exec vitest run` per the repo's split-suite landmine) and
      fix anything red. (`pnpm test` chains both; verified separately too. All green.)
- [x] 6.2 Query a real recent ticket's knowledge context (via the new route or a direct query against
      a dev daemon's database) and record the figure in the PR description as the pre-VS-109
      baseline the ticket's Verification section asks for. (No historical figure exists to query:
      `knowledge_usage_events` is a brand-new table with no backfill, no run before this change ever
      recorded anything, and reading the live daemon's own database directly is out of bounds per
      the "never touch the live install" rule. Stated honestly in the PR rather than fabricated; the
      real baseline is the first tickets whose runs execute after this merges and the daemon
      upgrades.)
- [ ] 6.3 Add one `ac_knowledge_note` (project scope) on the merge turn stating where the new table
      and service live and what the baseline figure was, per the worker's one-note-per-ticket rule.
