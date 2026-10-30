## Why

The empty-turn detector (VS-653, `runs/engine.ts` `finalize`) fails a worker turn as `empty_turn` when
the daemon holds no parseable report for it and the run left no comment, document, work product,
knowledge write or status change on its ticket. On 2026-10-30 a worker on a `merging` ticket,
correctly waiting in the serial merge queue, filed a `StructuredOutput` report ("paused, position 2")
and was failed anyway: the worker was paused and the ticket moved from `merging` to `blocked`, with a
retry approval raised to the human. The message also told the reader the worker "may have no way to
report", which the transcript contradicts.

## What Changes

- A worker turn whose run called `StructuredOutput` is never an `empty_turn`: the worker did file its
  report, so the "no way to report" premise is false. The run stays `succeeded`, the worker is not
  paused and the ticket's status is untouched.
- The `empty_turn` failure message states what was actually observed (no readable report, no ticket
  trace, `StructuredOutput` never called) instead of asserting the worker cannot report.

Not changed: a turn with no report, no evidence and no `StructuredOutput` call on an action-expecting
ticket still fails as `empty_turn` (VS-653); liveness classification and the three-empty-turns gate
are untouched.

## Impact

`packages/core/src/runs/engine.ts` and its test. No schema, API or UI change.

Open point: I could not see the VS-937 transcript, so I do not know whether the report failed to
parse or the runtime's result line carried no `structured_output`. This change makes the outcome safe
either way; it does not claim to explain why the report was unreadable.
