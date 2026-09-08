## Why

The stuck-worker gate (`packages/core/src/runs/engine.ts:516-528`) raises a `gate_finding` after three
consecutive runs with `liveness = 'empty'`. `classifyLiveness` (`engine.ts:106-117`) sets `'empty'`
whenever the turn's terminal report is missing or fails to parse — which is also, deliberately, what
`openspec/specs/worker-supervision/knowledge-reporting/spec.md` already specifies for a report
that skips the required `knowledge` field. That per-run signal is correct and stays as it is.

The bug is that the gate reuses that same raw signal as its only input, with no regard for whether
the turn actually did anything. Two problems, confirmed by reading the code (not by re-deriving the
incident from memory) and cross-checked against `docs/PLAN.md` §9.4 and the `knowledge-reporting`
spec, both real and both able to fire the gate on a worker that is not stuck:

1. **A validly-reported `idle` turn is scored identically to no report at all.** `state: 'idle'` is a
   legitimate, schema-valid report value — the worker skill's own `report-examples.md` gives exactly
   "a worker sitting on a delivered ticket, waiting on a human approval" as its canonical `idle`
   example — yet `classifyLiveness`'s `case 'idle': return 'empty'` puts it in the same bucket as a
   run whose report never parsed. `docs/PLAN.md` §9.4 already says an `idle` report should cost
   "without penalty" when the wake was not real work; the gate check never implemented that
   exemption, so a correctly-idle worker, re-woken by unrelated ticket activity while parked on an
   approval, can accumulate three `idle` reports and trip the same finding as an inert one.

2. **The gate ignores every durable thing a run actually produced.** A run's terminal report parsing
   is the only route into `liveness`; `ticket_comments`, `ticket_document_revisions`,
   `ticket_work_products` and `knowledge_revisions` all already carry the authoring `run_id`, and none
   of them are consulted. A turn that opened a PR, posted a delivery comment, wrote a document or
   recorded knowledge, but whose own terminal report happened not to validate — missing a required
   field, or never emitting one at all — is indistinguishable, to the gate, from a turn that did
   nothing. The `ac_report` tool's description (`packages/server/src/tools.ts:347`) claims it "updates
   liveness"; its handler only posts a ticket comment and emits a UI event
   (`tools.ts:348-367`) — it does not touch `runs.liveness`. That claim is simply false today, which
   is the likely source of the incident's "which channel a worker reports through" hypothesis: neither
   channel affects `runs.liveness` directly, so the two runs' different outcomes turned entirely on
   whether each one's own terminal report happened to validate, not on which tool call preceded it.

Left as is, a genuinely productive or correctly-idle worker can trip the same escalation ladder
(steer, relaunch, cancel) as a stuck one, which both wastes a turn and erodes the signal a real stuck
worker is supposed to stand out against.

## What Changes

- Give a validly-reported `idle` state its own `runs.liveness` value, distinct from `'empty'`
  (missing/invalid report), so the two are never conflated again anywhere they are read.
- Compute, once per finished run, whether it produced observable evidence of progress: a ticket
  comment, a document revision, a work product, or a knowledge revision authored under that run's
  `run_id`, or the ticket's `status` having changed since the run started. This does **not** change
  what makes a report valid — `knowledge-reporting`'s existing scenarios (a report missing its
  knowledge decision fails to parse, and that run's `liveness` stays `'empty'`) are untouched.
- Rewrite the three-consecutive-turns check so it counts a run against the worker only when the run
  produced no such evidence **and** the ticket was in a status where the worker was actually expected
  to act — not `proposed`, `in_review`, or `blocked`, where a worker is correctly waiting on someone
  else and is expected to do nothing.
- Correct `ac_report`'s tool description so it no longer claims to update liveness by itself; a
  mid-turn `ac_report` call already contributes evidence today (it writes a `ticket_comments` row
  under the run), and the description should say exactly that instead of overstating it.
- Update `docs/PLAN.md` §9.4's liveness paragraph and the `runs` table field list to describe the
  `idle` value and the evidence-based gate, replacing the never-implemented "digest or timer wake"
  exemption they currently describe.

## Capabilities

### New Capabilities

- `worker-supervision/stuck-worker-gate`: what counts as a "no progress" turn for the three-in-a-row
  stuck-worker `gate_finding` — the `idle`/`empty` distinction, the observable-evidence override, and
  the correctly-parked-ticket exemption.

### Modified Capabilities

(none — `knowledge-reporting`'s existing requirements, including that an invalid report's run has
`liveness = 'empty'`, are unchanged by this proposal; see design.md for why that boundary is kept.)

## Impact

- `packages/core/src/runs/engine.ts` — `classifyLiveness`, the three-consecutive-turns gate check, a
  new evidence lookup.
- `packages/shared/src/enums.ts` — `RUN_LIVENESS` gains `'idle'`.
- `packages/server/src/tools.ts` — `ac_report`'s description.
- `packages/ui/src/routes/Runs.tsx` (`LIVENESS_TEXT`) and any other surface listing liveness values by
  name, so the new value renders as a label rather than falling back to the raw string.
- `docs/PLAN.md` §9.4 and the `runs` table field list.
- No migration: every table the evidence check reads (`ticket_comments`, `ticket_document_revisions`,
  `ticket_work_products`, `knowledge_revisions`) already carries `run_id`; `runs.liveness` has no
  `CHECK` constraint to widen.
