# Design — a required knowledge decision, and a knowledge network that reports its own health

## Context

Three things exist today and none of them talk to each other:

| Fact | Where it is today |
|---|---|
| The final report schema | `RunReportSchema` (`packages/shared/src/report.ts`): `state`, `summary`, `tickets`, `nextAction`, `knowledgeUpdated: boolean` (defaulted `false`), `uncommittedWork`. Extracted by `extractReport` from a fenced ```json block or the model's structured output; `RunReportSchema.safeParse` failing for any reason (including a missing required field) makes `extractReport` return `null`. |
| What a missing report means | `classifyLiveness` (`packages/core/src/runs/engine.ts:100`): `report === null` → liveness `empty`. Today that only happens when `state` is missing or unparsable, because every other field is optional or defaulted. |
| Budget and curation mechanics | `packages/core/src/knowledge/files.ts` (`CURATION_BUDGET_FRACTION = 0.8`) and `service.ts`: `note()` already schedules curation proactively at 80% of budget, before rejection, and again on rejection itself. `supervisor/index.ts`'s `curationPass()` re-derives the same 80% verdict from current numbers every 10 minutes (VS-67) and asks for curation with a per-path daily cooldown. Neither tells the conductor anything beyond the ticket `spawnCurator` creates. |
| Orphans and unresolved links | Computed once, at write time, in `putDoc()`'s return value (`unresolvedLinks`, `backlinks`, `orphan`) and shown to whoever made that one write. Nothing recomputes or re-surfaces it afterwards. `listDocs()` already carries `backlinks` per document, so "orphan" is a filter away, not a new computation. |
| Provenance | `knowledge_revisions` already carries `author_kind`, `author_id`, `run_id`. What it does not carry is which *ticket* the run belonged to — the thing a future reader actually wants to open. |

The two acceptance criteria that matter most are the report field (load-bearing: it is the only
thing that runs on every single ticket, whether or not it touches knowledge) and the health view
(it is what makes the network's actual state visible instead of assumed). The templates are the
cheap half — text changes with no enforcement — and are not where this design spends its weight.

## Goals / Non-Goals

**Goals:**

- Make "did this ticket produce durable knowledge, and where" a question every report answers,
  the same way `state` already is, with "no" always a legitimate, unpenalised answer.
- Make the network's health legible without anyone having to remember to check: derived from
  numbers the daemon already keeps, refreshed on the same cadence the daemon already sweeps at.
- Tell the conductor about a project's knowledge getting worse *before* a write to it is rejected,
  using the same 80%-of-budget number `note()` and `curationPass()` already compute — not a new
  threshold, a new listener on the one that exists.
- Record which ticket a knowledge write came from, from this change forward.

**Non-Goals (explicitly, per the ticket):**

- No automatic summarisation and no agent writing knowledge unprompted. This change only makes the
  *decision* mandatory, never the writing.
- No change to the budgets, to `CURATION_BUDGET_FRACTION`, to the 14-day staleness window
  `curationPass` uses for hub files, or to how a curation run is requested. `knowledge/health`
  reads those numbers; it does not recompute or override them.
- No backfill of `ticket_id` onto existing `knowledge_revisions` rows.
- No enforcement of *truthfulness* — see the honesty section below, which is the part the ticket
  explicitly asked this design to be honest about.

## Decisions

### The report's `knowledge` field is required with no default, so a missing one already produces the same "incomplete" signal `state` does

```ts
knowledge: z.object({
  recorded: z.boolean(),
  where: z.string().trim().min(1).max(200).optional(),
  reason: z.string().trim().min(1).max(200).optional(),
}).refine(
  (v) => (v.recorded ? !!v.where : !!v.reason),
  { message: 'knowledge.where is required when recorded is true; knowledge.reason is required when recorded is false' },
)
```

Replacing `knowledgeUpdated` outright rather than adding `knowledge` alongside it: `knowledgeUpdated`
is read nowhere in the codebase today (confirmed by grep — only defined, never consumed), so there
is no migration to stage and no dual-write period to manage. The ticket says this is the load-
bearing half and should not be diluted by a parallel, ignorable field.

No `.default()` on `knowledge`, and the `refine` rejects a `recorded: false` with no `reason` (or a
`recorded: true` with no `where`). Either failure makes `RunReportSchema.safeParse` fail, which is
exactly what already happens today when `state` is missing: `extractReport` returns `null`,
`classifyLiveness` records liveness `empty`, and the turn looks, to the conductor and to the board,
exactly like a turn that reported nothing at all. This is deliberately the *existing* consequence,
reused rather than invented — a second, parallel "incomplete report" concept would be a second
thing to keep in sync with the first.

`RUN_REPORT_JSON_SCHEMA` (the structured-output hint some runtimes take) gets a plain — not
discriminated — object shape for `knowledge`, listing `recorded` as the only required key. Runtime
structured-output support for `oneOf`/`const`/`if-then-else` is inconsistent across the adapters in
`packages/runtimes/*`; the hint only needs to get the model close, and the Zod `refine` on the
server is the actual gate.

### Why this is honest about what it catches and what it does not (the plan's own question)

An agent can satisfy the schema with `{"recorded": false, "reason": "n/a"}` on every single ticket,
forever, and nothing here catches that — the acceptance criteria are explicit that the check must
never reward volume or punish a genuine "nothing durable," and a check that tried to judge whether
a stated reason was *good* would have to do exactly what it is told not to do (invent a bar an
honest "nothing to record" cannot clear). What this change catches is *silence*: a report that
skips the question, the way one can silently skip `knowledgeUpdated` today. That is a real
improvement — captain's complaint was that nothing forces the question to be asked, not that
answers to it need grading — but it should not be oversold as an honesty check on the answer
itself. The knowledge health view is the actual check on outcomes: it does not read reports at
all, it reads whether documents exist, link to each other, and stay current, which is the thing an
invented or lazy "recorded: true, where: PROJECT.md" cannot fake for long — an entry that was
never really written does not show up when the file is read.

### The health view is derived, on every call, from existing tables — no new table, no cache to invalidate

`KnowledgeService.health(projectId?)` computes, each time it is called:

- **hubs** — one row per hub file (`workspace`, `shared`, `decisions`, and the project's own when
  `projectId` is given), from the same `knowledge_files` query `lint()` already runs: path,
  `tokenEstimate`, `budgetTokens`, `pct`, and `nearBudget = pct >= 80` (reusing
  `CURATION_BUDGET_FRACTION`, imported, never re-declared).
- **orphans** — `listDocs({ projectId })` filtered to `backlinks === 0`. `listDocs` already computes
  `backlinks` per document for the doc panel; this is a filter, not new plumbing.
- **stale** — the same `listDocs` result filtered to `updatedAt` older than a new
  `DOCUMENT_STALE_MS` (90 days, declared once in `files.ts` next to `CURATION_BUDGET_FRACTION`).
  This is deliberately a different number from `curationPass`'s 14-day hub staleness: a hub file is
  stale when nobody has curated it in two weeks because hub files change constantly; a linked
  document going 90 days untouched is normal for something like an architecture rationale and only
  worth a flag well past that.
- **unresolvedLinks** — `knowledge_links` rows with `to_path IS NULL`, joined to the source file's
  title, scoped the same way `graph()` already scopes visibility (a project's own files plus
  `shared`).

Scoping follows the same rule every other knowledge read uses: no `projectId` means the workspace's
own view (hubs plus every project, for the conductor); a `projectId` means that project plus
`shared`, matching what a worker in that project can see.

### The supervisor tells the conductor on the same sweep it already runs, comparing against what it told last time

A new `knowledgeHealthPass()` in `supervisor/index.ts`, called from `tick()` next to
`curationPass()`, on its own `due()` cadence (`KNOWLEDGE_HEALTH_EVERY_MS`, 30 minutes — health
does not need `curationPass`'s 10-minute cadence, because it is a heads-up, not the thing that
triggers curation itself). For the workspace and for each project:

1. Compute `health(projectId)`.
2. Build a signature: the sorted set of orphan paths, unresolved `(from, slug)` pairs, stale doc
   paths, and near-budget hub paths.
3. Compare against the signature stored in `meta` under `supervisor:knowledge_health:<scope>` (the
   same `meta` table `curationPass`'s per-path cooldown already uses).
4. If the signature grew (something new appeared) or the total issue count is at or past a fixed
   threshold (5) and the per-scope cooldown (`CURATION_REQUEST_COOLDOWN_MS`, the same one
   `curationPass` uses, imported rather than redeclared) has elapsed, wake the conductor:
   `reason: 'knowledge_health'`, `payload: { projectId, orphans, unresolvedLinks, staleDocs,
   nearBudgetHubs }` (each capped to the first 10, matching `conductorDigest`'s own `slice(0, 30)`
   pattern for wake payload size).
5. Always persist the new signature, whether or not a wake fired, so a shrinking or unchanged
   network never re-notifies.

This is what folds the ticket's fifth acceptance criterion — "a hub file nearing its budget raises
curation before a write is rejected" — into the same mechanism: a hub crossing 80% is one of the
four signature components, so it reaches the conductor on this pass regardless of whether anyone
happens to write to that file again before the sweep runs. `note()`'s existing proactive
`fireCuration` at 80% (which spawns a curation run directly) is unchanged and is not superseded by
this — the health pass adds visibility, it does not replace the mechanism that already schedules
the work.

### Provenance is a nullable column, resolved from the run, not from the actor

`Actor` (`packages/core/src/api.ts`) carries `runId?: string | null` but not a ticket id, and it
should not grow one just for this — an actor is "who is calling," and a ticket is a property of
*this particular run*, which the `runs` table already records (`runs.ticket_id`, a real column
per `docs/PLAN.md`'s runs table). `write()` in `knowledge/service.ts` resolves
`ticketId = actor.runId ? db.get('SELECT ticket_id FROM runs WHERE id = ?', [actor.runId]) : null`
and persists it on the `knowledge_revisions` row it already inserts. A human or system write (the
web app's edit box, the daemon's own seeding, `appendDecision`) has no run and gets `ticketId:
null`, which is correct: there is no ticket to point at.

`revisions()` gains `ticketId: string | null` and `ticketIdentifier: string | null` (joined from
`tickets.identifier` for display) on each row it returns. `getDoc()`/`get()` are unchanged — the
provenance is visible in history, not baked into the current body.

### `project-overview`'s Knowledge requirement is extended, not given a new section

The reserved-sections pattern (`project-overview/reserved-sections`) exists for content that does
not exist *yet*; the health measures are additional facts about content that already has a
section (`overview-page`'s "the overview shows ... its knowledge" requirement). Extending that
requirement — orphan count, stale count, unresolved-link count, each linking into the knowledge
area filtered to it — keeps one section per genuinely distinct concern instead of fragmenting
"knowledge" across two sections on the same page.

## Risks

- **A careless "recorded: false, reason: n/a" on every ticket** is possible and is addressed above:
  this change catches silence, not laziness, by design, and the health view is the outcome check
  that does not depend on the report being honest.
- **The 90-day document-staleness window is a guess.** It is a health signal, not an enforcement
  mechanism (nothing is deleted or curated because of it), so a wrong guess costs a false or missed
  flag on the health view, not data loss. It is a named constant in one place if it needs tuning.
- **The digest wake for `knowledgeHealthPass` could still be noisy on a large workspace** if many
  projects cross the threshold at once (e.g., right after this change ships and every project's
  existing orphans register as "new" on the first sweep). Mitigated by seeding the signature from
  the *current* state on first sight of a scope (no wake on the first sweep for a scope, only on
  change thereafter) rather than treating a cold start as "everything just appeared."
