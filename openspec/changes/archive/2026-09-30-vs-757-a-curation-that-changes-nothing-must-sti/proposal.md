## Why

VS-732 (release 4ccb37ed3d, 2026-09-29) limits curation to one request per scope per 24 h and resets `last_curated_at` for the whole scope, but only inside `knowledge/service.ts` `write()` when `reason === 'curation'`. A curator that finds nothing to change correctly never calls `weave_knowledge_replace`, so nothing is stamped: every doc older than 14 days keeps `last_curated_at = NULL` and still qualifies as stale, and the 24 h interval becomes the only brake. Each such project now gets one no-op curation ticket (~59k input tokens) every day, forever, instead of every 14 days (VS-756, Fernwood, 2026-09-29). Separately, the supervisor logs `curation request failed: project … has no active role` on every sweep for projects with no role.

## What Changes

- **A curation ticket that ends `done` counts as curated.** When a ticket with `originKind: 'curation'` reaches `done`, the daemon stamps `last_curated_at` and clears `curation_pending` on every knowledge file of that project scope, exactly as a curation write does, and refreshes the interval stamp. Hook: `propagateTerminal` in `packages/core/src/tickets/service.ts`, which every path into a terminal status runs (`transition`, `cancel`, `mergeDone`); it acts only for `done`, so `cancelled` stamps nothing.
- **Workspace-scope curations by the weaver have no ticket and no completion signal** (the `curate` wake is fire-and-forget, `knowledge/service.ts` `requestCuration`). They keep stamping on `weave_knowledge_replace` only; the limitation is documented in the design.
- **A project with no active role logs the failure once per interval.** `requestCuration` stamps the same interval key when spawning a curator fails with `wrong_status` on a non-forced request, so later sweeps are suppressed by the existing "within the interval" check. A manual (forced) request still throws every time.
- VS-732's behaviour is unchanged: one request per scope, the 24 h interval, manual and over-budget bypass, sibling stamping on a write.

## Capabilities

### Modified Capabilities

- `knowledge/scheduled-curation`: a curation ticket finishing `done` without a write resets the scope's freshness; a failed spawn holds the scope for the interval.

## Impact

- `packages/core/src/knowledge/service.ts` — `markCurated(scope, projectId)` extracted from `write()`'s scope stamping; `requestCuration` stamps on a non-forced spawn failure.
- `packages/core/src/api.ts` — `KnowledgeService.markCurated`.
- `packages/core/src/tickets/service.ts` — `propagateTerminal` calls it for a `done` curation ticket.
- Tests in `knowledge.test.ts`, `tickets` and `supervisor.test.ts`. No route, CLI or config surface changes.
