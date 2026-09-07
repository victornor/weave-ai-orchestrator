## Why

Captain (2026-09-07): "How do we ensure that workers and conductors make use of the documentation
features? It's important that we continuously build a network of documents, such that every
decision can be grounded in context when needed."

Today nothing ensures it, and every mechanism that exists points at short notes rather than
documents:

- The worker charter template says "at most one concise `ac_knowledge_note` per ticket" — a cap,
  phrased as a limit, with no requirement to write anything and no mention of
  `ac_knowledge_doc_put` at all.
- The final report (`RunReportSchema`, `packages/shared/src/report.ts`) carries `knowledgeUpdated:
  boolean`, defaulted to `false` and read by nothing — an agent that never touches it produces an
  identical, valid report to one that made a real decision to write nothing.
- Nothing checks afterwards. A run whose report field is wrong or absent is indistinguishable from
  one that genuinely had nothing to record.
- Nothing surfaces the network's health after the fact: an orphan document is reported once, at
  the moment it is written, and never again; a document nobody has revisited in months is
  invisible; a hub file nearing its budget is only discovered when a write to it is rejected.

The result is what captain observed: notes accumulate in the hub files until they hit budget,
while the documents that would carry reasoning are written only when a worker happens to think of
it.

## What Changes

- **The final report gets a required `knowledge` decision, not a boolean.** `knowledgeUpdated`
  is replaced by `knowledge: { recorded: true, where } | { recorded: false, reason }`. The field is
  required with no default, so a report missing it fails to parse the same way a report missing
  `state` does today: the run's liveness is `empty`, exactly as an absent report is now. "Nothing
  durable" is always a legal answer — the check is that the question was answered, never that
  something was written.
- **Documents become a first-class, explicit option** in the worker charter template, the worker
  prompt template and the conductor's own instructions: each states, in the same place it mentions
  `ac_knowledge_note`, when a short note is right and when a linked document is right (reasoning, a
  survey, a design rationale — anything past a few sentences), and that a document is only findable
  once it is linked from its hub file or from another document.
- **A knowledge health view**, derived on read from data the daemon already has (no new table):
  every hub file's size against its configured budget, every linked document with no backlink,
  every linked document not written to in 90 days, and every `[[link]]` that does not resolve.
  Reachable as `GET /knowledge/health` (optionally scoped `?project=`), and as a section on the
  project overview.
- **The supervisor tells the conductor** when a project's knowledge health changes for the worse —
  a new orphan, a new unresolved link, a hub file crossing 80% of its budget — the same signal a
  human reading the health view would notice, delivered before a write is ever rejected for being
  over budget, not after. Below the threshold and unchanged, it says nothing: this is the existing
  scheduled-curation cadence, given a voice, not a new poll.
- **Every knowledge write records its author's ticket**, alongside the author it already records:
  `knowledge_revisions` gains a nullable `ticket_id`, populated from the actor's run at write time.
  Existing revisions are untouched. The web app's existing revision history shows the ticket beside
  the author it already shows.

## Capabilities

### New Capabilities

- `knowledge/health`: the four health measures, how they are derived, the route and the project
  overview section that show them, and the supervisor signal that surfaces a worsening project to
  the conductor ahead of a rejected write.
- `knowledge/provenance`: every knowledge write (a note or a document) records which ticket
  produced it, from the change forward.
- `worker-supervision/knowledge-reporting`: the final report's required `knowledge` field, its two
  shapes, and that a report missing or misusing it is treated as no report at all.

### Modified Capabilities

- `project-overview/overview-page`: the existing "Knowledge" requirement gains the health measures
  for that project — its orphan documents, its stale documents and its unresolved links — alongside
  the sections and documents it already lists.

## Impact

- `packages/shared/src/report.ts` — `RunReportSchema`, `RUN_REPORT_JSON_SCHEMA`; `knowledgeUpdated`
  removed, `knowledge` added. Not read anywhere else today, so nothing else in `packages/shared`
  moves.
- `packages/core/src/knowledge/service.ts`, `files.ts` — a `health(projectId?)` method and the
  staleness constant it uses; `write()` resolves and persists `ticketId`; `revisions()` returns it.
- `packages/core/src/api.ts` — `KnowledgeService.health`, its return type, `ticketId` /
  `ticketIdentifier` on the revisions shape; `CoreServices` unchanged (no new service).
- `packages/core/src/supervisor/index.ts` — a `knowledgeHealthPass`, on the same kind of cadence
  and cooldown as `curationPass`.
- `packages/db/src/migrations/` — one migration: `knowledge_revisions.ticket_id`, nullable, no
  backfill.
- `packages/server/src/routes/knowledge.ts` — `GET /knowledge/health`.
- `packages/ui` — a `KnowledgeHealthSection` (or an extension of the existing `KnowledgeSection`)
  on the project overview, a hook, a query key and its event mapping; the existing revision list in
  `Knowledge.tsx` gains the ticket link.
- `templates/charter.md.tmpl`, `templates/worker.AGENTS.md.tmpl`, `templates/conductor.AGENTS.md.tmpl`
  — the note-vs-document line and the new report field's example JSON.
- `docs/PLAN.md` §9.4 (the report shape) and §13 (a new subsection for the health view and
  provenance) — the naming contract follows the code.
- No change to the curation algorithm itself, to the configured budgets, or to how curation runs
  are requested — `knowledge/health` reads the same numbers `knowledge/scheduled-curation` already
  computes and gives them a conductor-facing voice.
