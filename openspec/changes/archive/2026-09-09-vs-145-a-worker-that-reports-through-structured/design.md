## Context

`packages/core/src/runs/engine.ts` computes `runs.liveness` once, in `classifyLiveness` (`:106-117`),
from exactly one input: the turn's terminal report (`result.structured`, parsed by
`RunReportSchema`, or `extractReport(result.finalText)` as a fallback — `:319-326`). The
stuck-worker gate (`:516-528`) reads that same stored value back for the worker's three most recent
successful runs and raises a `gate_finding` when all three are `'empty'`.

`openspec/specs/worker-supervision/knowledge-reporting/spec.md` already specifies, deliberately
(VS-102), that a report missing its required `knowledge` decision fails to parse and its run's
liveness is `'empty'` "on the same terms as a report missing its state" — a forcing function to make
workers answer the knowledge question every turn. That requirement is doing its job and this change
does not touch it.

Every table an evidence check would need already carries the authoring run's id with no migration
required: `ticket_comments.run_id`, `ticket_document_revisions.run_id`, `ticket_work_products.run_id`,
`knowledge_revisions.run_id` (all `packages/db/src/migrations/0001_init.sql`, plus
`0015_knowledge_usage.sql` for knowledge). `FinalizeInput.ticket` (`engine.ts:339`) is the ticket row
as it was loaded at the *start* of the run (`engine.ts:140`), before any phase ran — comparing it to a
fresh read at finalize time is how "did the ticket's status change" is answered without a new column.

## Goals / Non-Goals

**Goals:**
- Stop a validly-idle or evidently-productive run from being indistinguishable, to the gate, from one
  that did nothing.
- Keep the gate firing for a genuinely inert worker, with a test proving it still does.
- Leave `knowledge-reporting`'s existing contract — what makes a report valid, and that an invalid
  report's own run is `'empty'` — completely alone.

**Non-Goals:**
- Redefining what makes a terminal report valid, or softening the knowledge-decision requirement.
- Changing retry/backoff, parking, or any failed-run path — this only touches the path for
  `succeeded` runs feeding the three-consecutive-turns check.
- A general "worker health score." The gate stays a narrow, specific check.

## Decisions

### 1. Keep `runs.liveness = 'empty'` meaning "this run's own report didn't validate"; move progress-awareness into the gate, not into `classifyLiveness`

**Alternative considered:** make `classifyLiveness` itself return `'advanced'` whenever evidence
exists, even if the report fails to parse — i.e., let observable progress override the report-validity
signal at the source.

**Rejected because** it would silently rewrite `knowledge-reporting`'s own scenarios ("a report
missing its knowledge decision fails to parse and the run's liveness is `empty`") for runs that
happen to also do other things — which is most of them. A worker could then skip the knowledge
question every turn as long as it also posts a comment, and `runs.liveness` would stop being a
trustworthy signal of report quality for anyone auditing it later (the `ac_run_inspect`/`ac_run_list`
tools, the Runs page). The three-consecutive-turns gate is the one place this incident showed the
signal was being misused for something it was never precise enough for ("is this worker stuck"); the
fix belongs there, not in the per-run classification.

**Consequence:** a run can be `liveness = 'empty'` and still not count toward the gate. That is
intentional — `'empty'` keeps meaning "report didn't validate," and the gate now asks a narrower,
different question ("did this run also produce nothing else observable").

### 2. `idle` gets its own liveness value

`state: 'idle'` is schema-valid and means "correctly did nothing this turn" — the opposite of
"report didn't validate." Folding it into `'empty'` was the concrete bug: `docs/PLAN.md` §9.4 already
promises `idle` costs "without penalty," and the gate check never implemented that. Giving it its own
`RUN_LIVENESS` entry (`'idle'`) is the direct fix and needs no evidence lookup to get right — a valid
`idle` report is proof enough on its own that the turn was not stuck, it was correctly quiet.

### 3. Evidence is per-run, from tables that already carry `run_id`

Considered adding a dedicated "progress" event type to `run_events` instead of querying four tables.
Rejected: `run_events` already exists per-run and is large; the four evidence tables are exactly the
durable, ticket-facing artifacts the acceptance criteria name (comment, work product, document,
knowledge), each already keyed by `run_id`, and a `SELECT 1 ... LIMIT 1` against each is cheap and
needs no schema change. `ac_report`'s own comment write lands in `ticket_comments`, so it already
counts as evidence under this scheme without any special-casing — which is also what makes its
description fixable to something true instead of something that has to keep being true by coincidence.

### 4. "Correctly parked" is a fixed ticket-status set, not the wake's source

PLAN §9.4's text ties the old (unimplemented) exemption to the wake's source (digest/timer). For a
*worker* specifically, the far more direct and legible signal is the ticket's own status: `proposed`,
`in_review`, and `blocked` are exactly the statuses in which `agent-conductor-worker`'s own turn-loop
table says there is nothing for the worker to do but wait. Using ticket status instead of wake source
also composes correctly with the evidence check — a worker correctly parked in `in_review` who is
re-woken by an unrelated comment and takes no action produces neither evidence nor a status change,
which the evidence check alone would already exclude from the gate; the status check is what stops
those turns from being *counted* in the first place, matching AC #2 ("does not raise a stuck-worker
gate finding") rather than merely not adding to a count that never gets checked. `docs/PLAN.md` §9.4
is updated to describe this replacement rather than the exemption it never implemented.

## Risks / Trade-offs

- **[Risk]** A worker could, in principle, post a low-effort ticket comment every turn purely to dodge
  the gate while making no real progress. → **Mitigation**: this is already possible today by any
  worker whose report happens to validate (which requires nothing about the report's content beyond
  the knowledge decision, per `knowledge-reporting`'s own "never graded on content" requirement) — the
  gate has never been, and is not becoming, a quality check. It is a cheap, blunt "did anything at all
  happen" signal, and this change makes that signal more accurate, not less blunt.
- **[Risk]** The evidence lookup adds up to four extra point reads per finalized run. → **Mitigation**:
  each is an indexed or trivially small lookup (`ticket_comments` is indexed on `ticket_id`; the
  others are looked up by `run_id`, one row per run in the overwhelming common case); this runs once
  at the end of a turn, not in a hot path.
- **[Trade-off]** A worker whose ticket sits in `in_review` for a long time, doing nothing, is now
  invisible to this particular gate for as long as it stays there. → **Accepted**: that is exactly AC
  #2's intent — a delivered, correctly-idle worker is not what this gate exists to catch. A ticket
  stalled in `in_review` is covered by the supervisor's separate liveness-repair scan
  (`docs/run-engine.md` §6, `supervisor/index.ts:192`), which is unaffected by this change.

## Migration Plan

No data migration. `RUN_LIVENESS` widens (additive; no `CHECK` constraint on `runs.liveness` to
alter). Deploys as an ordinary code change: the next run finalized after the upgrade uses the new
classification and gate logic; no backfill of past runs' stored `liveness` values is needed or
proposed — the gate only ever looks at the three most recent runs going forward.
