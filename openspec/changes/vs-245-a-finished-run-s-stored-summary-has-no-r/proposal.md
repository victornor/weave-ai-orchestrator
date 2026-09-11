## Why

Every run finalises with a stored structured report (`runs.result_json`, written at
`packages/core/src/runs/engine.ts:471`), but non-test code has no reader for it: the report an agent is
required to end every turn with is stored and never read back. The conductor's periodic digest
reports a finished run as a bare `run.finished` marker, so the only way to learn what a worker
concluded is `ac_run_inspect` — the right tool for "what was it doing when it got stuck", and an
expensive one (up to 200 events / 32 KB) for "what did it say it did".

The conductor already receives a digest wake naming the run. Carrying the stored summary in that same
wake lets it read the outcome without a second, heavy call, and reserves `ac_run_inspect` for the
detail it is built for.

## What Changes

- A `run.finished` entry in the supervisor's conductor digest carries the finished run's stored report
  summary, capped, and labelled as the reporting agent's own account — an account, not evidence, the
  same distinction the charter draws about worker reports.
- A run that stored no report, or that failed before recording one, produces an explicit, non-blank
  entry instead of an empty summary.
- The summary text is bounded: a per-entry limit plus a per-digest total ceiling, so a burst of
  finished runs between two digests cannot grow the digest without bound.
- `runs.result_json` gains its first non-test reader.
- No change to what agents report, to `RunReportSchema`'s own field limits, or to `ac_run_inspect`.

## Capabilities

### New Capabilities

- `worker-supervision/conductor-digest`: what the conductor's periodic digest carries about a
  finished run — the stored report summary, its attribution as the agent's own account, the explicit
  entry when no report was stored, and the size bounds that keep the digest from growing with the
  number of runs.

### Modified Capabilities

(none — no existing capability specifies the digest's `run.finished` entry content; this adds that
contract without changing any existing requirement. `worker-supervision/run-inspection` and the
report schema are untouched.)

## Impact

- `packages/core/src/supervisor/index.ts` — `conductorDigest()` maps each included event to a small
  entry; the `run.finished` branch reads the run row and attaches a bounded summary.
- `packages/core/src/supervisor/supervisor.test.ts` — coverage for the summary being carried, the
  absent-report and capped-budget entries, and the total bound.
- No migration, no schema change, no shared-package change, no API/route change. The stored report
  already exists in `runs.result_json`.
