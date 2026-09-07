## Context

Two knowledge paths exist today and neither is instrumented:

- **Bootstrap**: `KnowledgeService.bootstrapDigest(agentId)` (`packages/core/src/knowledge/service.ts:451-486`)
  assembles a text blob per agent kind — full `shared`/`workspace`/`decisions`/project-hub bodies for
  a worker, plus a per-project `Overview`/`Current focus` chunk for the conductor — and only measures
  the *joined* result (`estimateTokens(text)`) against `bootstrapBudgetTokens`, truncating if over. It
  is called from `buildTurnPrompt` (`packages/core/src/prompts/index.ts:304-306`), which is in turn
  called from the engine's `build_prompt` phase (`packages/core/src/runs/engine.ts:202-206`), where
  `runId` is already in scope (used two lines later to mint the run token).
- **Explicit reads**: `ac_knowledge_get` and `ac_knowledge_doc_get` (`packages/server/src/tools.ts:301-323`)
  call `KnowledgeService.get`/`getDoc` and return the result. `runTool` (`tools.ts:566-577`) never
  logs a call; `ToolCtx.claims` (`packages/core/src/runs/runtoken.ts:11-19`) already carries
  `runId`, `agentId`, `ticketId`, `projectId` for every tool invocation.

`usage_events` (`packages/db/src/migrations/0001_init.sql:129-138`) and
`packages/core/src/usage/service.ts` are the existing precedent for "per-run event table + scoped
aggregation service" and are followed closely below, but knowledge context is a different question
(bytes of knowledge text reaching the model) from token/cost usage (billed model tokens), so it gets
its own table and service rather than a new column on `usage_events` or `runs`.

## Goals / Non-Goals

**Goals:**
- Record, per run, exactly which hub chunks and which documents contributed knowledge-context
  tokens, deduped per distinct document per run.
- Roll that up per ticket (sum across its own runs and any child tickets, matching the existing
  ticket-usage subtree behaviour) and per project/window (average per run, top documents, never-read
  documents).
- Make the measurement basis explicit everywhere it is shown.

**Non-Goals:**
- Live SSE push of every individual read as it happens. The existing per-ticket usage tab has the
  same gap (`qk.ticketUsage` is not nested under `qk.usageRoot`, so `usage.recorded` does not reach
  it either); this change fixes it for the new keys it adds via targeted invalidation, but does not
  attempt sub-second liveness for reads mid-turn. A ticket or usage page reflects reads once the run
  that made them has advanced far enough to invalidate its own query, which is adequate for a
  measurement-only feature nobody is meant to watch live.
- Any throttling, budget enforcement, or behavioural change based on these numbers (explicitly out
  of scope in the proposal).
- Repository-file reads, VS-98's total-context tracking, and VS-102's knowledge-health view — all
  unchanged.

## Decisions

### A new `knowledge_usage_events` table, not a column on `runs` or `usage_events`

`runs.usage_json` holds one blob per run (input/output/cached/context tokens) because model usage is
naturally one number per run. Knowledge context is naturally a *list* — zero to many hub chunks, zero
to many documents — with per-project and per-slug grouping needed for the "most/never read" queries.
That shape is exactly what `usage_events` already solved for model usage (one row per billable
event, grouped and windowed in `usage/service.ts`); knowledge context gets the same shape in its own
table so a document read is never confused with a billed token, and so the "once per distinct
document per run" rule can be enforced by a unique index rather than application logic that could
drift.

Schema (new migration, `packages/db/src/migrations/0015_knowledge_usage.sql`):

```sql
CREATE TABLE IF NOT EXISTS knowledge_usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  agent_id TEXT NOT NULL,
  ticket_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('hub','document')),
  scope TEXT NOT NULL CHECK (scope IN ('workspace','shared','decisions','project')),
  project_id TEXT,
  slug TEXT,
  tokens INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_usage_dedupe
  ON knowledge_usage_events(run_id, kind, scope, IFNULL(project_id, ''), IFNULL(slug, ''));
CREATE INDEX IF NOT EXISTS knowledge_usage_ws_time ON knowledge_usage_events(workspace_id, occurred_at);
CREATE INDEX IF NOT EXISTS knowledge_usage_project_time ON knowledge_usage_events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS knowledge_usage_ticket ON knowledge_usage_events(ticket_id);
```

`kind` distinguishes a bootstrap-rendered chunk (`hub`) from an explicit tool-call read
(`document`) — `ac_knowledge_get` on a hub scope is `document` kind too, per the spec's "an explicit
hub read is recorded as a read, not folded into bootstrap" scenario: the same scope can legitimately
appear once as `hub` and once as `document` in the same run, because the tool result is a second,
separate blob returned to the model. `slug` is null for hub chunks and for `ac_knowledge_get`
(there's no slug, only a scope); it is set for `ac_knowledge_doc_get`. `project_id` is set for
`scope = 'project'` and null otherwise. The unique index is what implements "counted once per
distinct document per run" — a second read of the same `(run_id, kind, scope, project_id, slug)`
is inserted with `INSERT OR IGNORE` and silently drops.

### `bootstrapDigest` returns a per-chunk breakdown alongside the joined text

`bootstrapDigest` keeps its `{ text, tokens, truncated }` return shape and gains a fourth field,
`parts: { scope: KnowledgeScope; projectId: string | null; tokens: number }[]`, built by measuring
each chunk with `estimateTokens` at the point it is assembled — before the join and before the
budget truncation — rather than reading `knowledge_files.token_estimate` (which is the *whole
file's* estimate; the conductor's per-project chunk is only two sections of it, and would badly
overstate that chunk's actual cost if read from the column). This satisfies the "as actually
rendered, not the file's stored estimate" requirement directly: the number comes from the same
`estimateTokens` call on the same substring that was pushed into `parts` (the digest builder's local
variable, not the file row).

One known imprecision, accepted rather than engineered around: if the *joined* digest later gets
truncated (`truncateLearnings` or the hard head-cut), the recorded per-chunk tokens are the
pre-truncation figures, since truncation acts on the joined string, not per-source-chunk. This can
overstate hub tokens slightly in the rare truncation case. Re-deriving post-truncation per-chunk
tokens would mean slicing the truncated text back into per-source pieces, which is more machinery
than a rare edge case justifies; it does not affect the `text`/`tokens`/`truncated` fields callers
already rely on for the prompt itself.

### Recording is wired at two call sites, both already holding the identifiers it needs

- **Bootstrap**: `engine.ts`'s existing `promptOptions` object (already threaded into
  `buildTurnPrompt`) gains a `runId` field, set right before the `buildTurnPrompt` call alongside the
  other fields already assigned there. Inside `buildTurnPrompt`, immediately after computing
  `bootstrapDigest`, call `deps().knowledgeUsage.recordBootstrap(opts.runId, agent.id, agent.ticketId ?? null, digest.parts)`,
  wrapped in the same `try { } catch { }` already guarding the digest call — a recording failure must
  never break prompt assembly (spec: "measuring knowledge context never changes agent behaviour").
- **Explicit reads**: inside the `ac_knowledge_get` and `ac_knowledge_doc_get` handlers in
  `packages/server/src/tools.ts`, after the existing `service.get`/`getDoc` call succeeds, call
  `svc(ctx).knowledgeUsage.recordRead({ runId: ctx.claims.runId, agentId: ctx.claims.agentId,
  ticketId: ctx.claims.ticketId, kind: 'document', scope, projectId, slug, tokens: result.tokenEstimate })`,
  also wrapped so a recording failure cannot turn a successful read into a tool error.

Both writers go through one `KnowledgeUsageService` (`packages/core/src/knowledge/usage.ts`, new),
added to `CoreServices`, so there is exactly one place that knows the table's shape.

### `KnowledgeUsageService` shape (added to `packages/core/src/api.ts`)

```ts
interface KnowledgeUsageService {
  recordBootstrap(runId: string, agentId: string, ticketId: string | null, parts: KnowledgeBootstrapPart[]): void;
  recordRead(evt: KnowledgeReadEvent): void;
  forRun(runId: string): KnowledgeContextUsage;
  forTicket(ticketId: string): KnowledgeContextUsage; // sums the ticket's own runs plus its subtree, matching UsageService.ticket()'s SUBTREE_SQL
  summary(query: KnowledgeUsageQuery): { averageTokensPerRun: number; runs: number };
  topDocuments(query: KnowledgeUsageQuery, limit?: number): KnowledgeDocumentUsage[];
  neverRead(query: KnowledgeUsageQuery): KnowledgeDocumentRef[];
}
```

`KnowledgeContextUsage = { hubTokens: number; documentTokens: number; totalTokens: number; documents: { scope, projectId, slug, tokens }[] }`.
`KnowledgeUsageQuery = { projectId?: string; window?: S.UsageWindow }` — reusing the existing
`resolveUsageWindow` helper from `packages/shared` so the window semantics match the rest of the
usage view exactly.

`forRun`/`forTicket` return the zero-value shape (`{ hubTokens: 0, documentTokens: 0, totalTokens: 0,
documents: [] }`) rather than `null` when there are no rows, satisfying "a run that reads nothing
records zero, not null" without a placeholder row.

`topDocuments` groups `knowledge_usage_events` by `(scope, project_id, slug)` where `kind = 'document'
AND slug IS NOT NULL`, counting `COUNT(DISTINCT run_id)` as reads, ordered descending, `LIMIT 20` —
the same shape as `UsageService.top()`. `neverRead` starts from the document catalogue
(`KnowledgeService.listDocs`, scoped the same way) and excludes any `(scope, project_id, slug)` that
appears in `knowledge_usage_events` within the window via `NOT EXISTS`.

### API routes

New read-only routes under `/knowledge/usage`, registered in `packages/server/src/routetable.ts`
next to the existing `/usage/*` block:

- `GET /tickets/:id/knowledge-usage` → `forTicket` (sibling to the existing `GET /tickets/:id/usage`)
- `GET /knowledge/usage/summary?project=&window=` → `summary`
- `GET /knowledge/usage/top?project=&window=&limit=` → `topDocuments`
- `GET /knowledge/usage/never-read?project=&window=` → `neverRead`

A per-run figure is reachable through `forRun` inside `forTicket`'s aggregation but is not given its
own route; nothing today needs a bare per-run number outside the ticket rollup, and adding one
unused route is not warranted.

### UI

- `TicketPage.tsx` gains a `knowledge` tab next to the existing `usage` tab, backed by a new
  `useTicketKnowledgeUsage(ticketId)` hook hitting the new route, rendering hub/document/total stat
  tiles, the document list, and the one-line method statement the spec requires.
- `Usage.tsx` gains a "Knowledge context" section (its own stat tile for average tokens/run, a
  `RankedBars` block for top documents, and a plain list for never-read documents), using the same
  `project`/`window` picker already on that page, via three new hooks
  (`useKnowledgeUsageSummary`, `useKnowledgeUsageTop`, `useKnowledgeUsageNeverRead`).
- New query keys (`qk.ticketKnowledgeUsage`, `qk.knowledgeUsageRoot`, `qk.knowledgeUsageTop`,
  `qk.knowledgeUsageNeverRead`) and one new event, `knowledge_usage.recorded`, emitted once per
  `recordBootstrap`/`recordRead` call (mirroring `usage.recorded`). Per the VS-95 landmine, a new key
  is wired explicitly in `events.ts` rather than assumed covered by an existing root: the handler
  invalidates both `qk.knowledgeUsageRoot(ws)` and, when the event payload carries a `ticketId`,
  `qk.ticketKnowledgeUsage(ws, ticketId)` directly — the same explicit dual-invalidate `thread.message`
  already uses, rather than relying on prefix matching that the existing `ticketUsage` key shows does
  not reach a `tickets/:id/...` key from a root under `usage`.

## Risks / Trade-offs

- **Read volume**: a `recordRead` write on every `ac_knowledge_get`/`ac_knowledge_doc_get` call adds
  one small `INSERT OR IGNORE` per call. This is the same order of magnitude as the existing
  `recordActivity` writes on other tool calls and is not expected to be measurable against an LLM
  turn's own latency.
- **Truncation imprecision** (see above) → accepted; documented, does not affect the prompt itself.
- **`ac_knowledge_get` explicit reads double-count against bootstrap** when an agent re-reads a hub
  scope it already has → intentional, not a bug: it is a second blob returned to the model and does
  cost context a second time; the spec has an explicit scenario for this.

## Migration Plan

Additive migration, no backfill: historical runs have no rows and their `forRun`/`forTicket` report
zero, which is honest (they were genuinely never measured) rather than misleading. No rollback
concern beyond the standard migration-down story already used elsewhere in the migrations directory
(none of the recent additive migrations in this repo ship a down migration; this follows the same
convention).

## Open Questions

None — the ticket resolves the shape of what to measure and how to attribute it in its own
acceptance criteria; nothing here needs the human's call to proceed to tasks.
