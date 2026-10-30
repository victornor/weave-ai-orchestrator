## Why

On 2026-10-30 a worker on a `merging` ticket (VS-937), correctly waiting in the merge queue, filed a
`StructuredOutput` report and was failed as `empty_turn`: the worker was paused and the ticket moved
from `merging` to `blocked`.

**Confirmed cause (conductor, from the run's data).** `knowledge.reason` was 220 characters against the
schema's 200-character limit. A field-length violation discarded the entire report.

**Finding.** The run's stored `summary` is the report's complete JSON text. `finalize` sets
`summary = f.report?.summary ?? … ?? r.finalText.slice(0, 1000)`, so a stored summary that is the raw
JSON means `f.report` was null and the text came from the `finalText` fallback. It is not a race:
`collect_result` is awaited before `finalize` and `finalize` reads `f.report` directly. The report was
well-formed JSON that `RunReportSchema` rejected. The one rule in that schema that rejects an otherwise
complete report is `knowledge` (VS-102): `recorded:false` with no `reason` (or a `reason`/`where` over
200 characters) makes the whole report parse as "no report". The ticket's quote elides the `knowledge`
object, so which of those it was is not confirmed; the ticket's transcript is needed to say.

The detector's premise ("no report, so the worker may have no way to report") is therefore false for a
report that arrived but failed validation, and the daemon throws away *why* it was rejected.

## What Changes

- When the strict parse fails but the payload is report-shaped (a valid `state`), the engine records a
  `run.report.invalid` run event carrying the schema issues. The rejection is no longer silent.
- Such a turn is not failed as `empty_turn`: the worker demonstrably reported, so it is not paused and
  its ticket's status is untouched. Its liveness stays `empty`, because no usable report was stored.
- The `empty_turn` message states what was observed and no longer asserts the worker cannot report.

- **Root fix (revision 3).** A structurally valid report with an over-long string field
  (`summary` > 4000, `knowledge.where`/`knowledge.reason` > 200) is accepted with that field truncated to
  the limit, ending in `…` so a reader can see it was cut, and a `run.report.truncated` event records
  each field, its original length and its limit. The limits themselves are unchanged. Hard rejection is
  kept for a malformed report: wrong shape, missing/invalid `state`, a missing required `knowledge` or
  an empty `reason`/`where`, unparseable JSON.

Deliberately not changed: the limits, and VS-102's required `knowledge`. The exemption is keyed on an invalid-but-state-bearing report, not on "the
worker called `StructuredOutput`", so a turn with no report at all still fails as `empty_turn`.

## Impact

`packages/core/src/runs/engine.ts`, its test, and the `empty-turn-detection` spec. No schema, API or UI change.
