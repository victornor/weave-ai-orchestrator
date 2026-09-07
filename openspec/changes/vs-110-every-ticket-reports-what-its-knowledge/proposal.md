## Why

VS-109 moves the project hub's content into subject documents behind pointers, on the reasoning
that a worker reads only the documents relevant to what it is touching. That reasoning is a
prediction, and nothing today measures it: a worker's knowledge context — the hub files it was
bootstrapped with plus every document it read — has no per-run record, no per-ticket rollup, and no
view of which documents are read often versus never. If workers routinely open six documents, the
split costs more context than the wall it replaced; today that is invisible either way.

## What Changes

- A run records its knowledge context as it happens: the tokens of every hub file rendered into its
  bootstrap digest (by scope and, for the per-project chunk, by project), and the tokens of every
  document a knowledge read returned during the run (`ac_knowledge_doc_get`, and `ac_knowledge_get`
  when called explicitly) — each distinct document counted once per run even if read twice.
- A ticket exposes the sum of its runs' knowledge context (hub tokens, document tokens, total) and
  the distinct documents its work touched, alongside the existing token/cost usage tab.
- The usage view gains a knowledge section answering, per project and time window: average knowledge
  tokens per run, the documents read most often, and the documents never read.
- Every place a knowledge-context figure is shown states in one line that it is knowledge context,
  not total context (VS-98's `usage.contextTokens` stays a separate, unrelated number).
- Nothing about agent behaviour changes: no throttling, capping or refusal is added. This is
  measurement only, and it works whether or not VS-109 has landed.

## Capabilities

### New Capabilities
- `knowledge/context-accounting`: per-run and per-ticket knowledge-context token accounting (hub
  bootstrap tokens plus distinct-document read tokens), and the project/window rollups (average per
  run, most-read documents, never-read documents) that read it back.

### Modified Capabilities
(none — this is new, additive behaviour; no existing requirement changes)

## Impact

- `packages/db`: one new migration adding a `knowledge_usage_events` table.
- `packages/core/src/knowledge/service.ts`: `bootstrapDigest` reports which hub chunks it rendered
  and each one's actual token count, not just the joined digest's total.
- `packages/core/src/knowledge/usage.ts` (new): records bootstrap and read events, and answers the
  per-run, per-ticket, and project/window rollup queries.
- `packages/core/src/prompts/index.ts`, `packages/core/src/runs/engine.ts`: record the bootstrap
  breakdown for the run being spawned.
- `packages/server/src/tools.ts`: `ac_knowledge_get` and `ac_knowledge_doc_get` record a read event
  after returning their result.
- `packages/core/src/api.ts`, `packages/server/src/routetable.ts`: a `KnowledgeUsageService` and new
  read-only routes under `/knowledge/usage/*`.
- `packages/ui`: a knowledge tab on the ticket page, and a knowledge section on the usage view.
