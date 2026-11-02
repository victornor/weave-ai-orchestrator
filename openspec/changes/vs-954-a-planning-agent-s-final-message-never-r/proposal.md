## Why

A planning agent's only delivery is `weave_plan_reply`; its plain final text is stored as the run
summary, cut to 1000 characters (`engine.ts` `finalize`), and posted nowhere. On `v-ofm` three planner
turns whose final text passed 1000 characters left no message in the plan thread (one left only a
48-character heading) while all three runs reported `succeeded`; four turns under 1000 posted fine.
Captain sees the stream, then it disappears and nothing replaces it. Long planning answers are the
normal case, and nothing records that one was lost.

Finding on VS-943 (`ecd30a40`): it fixed report parsing for worker turns (`RunReportSchema`
truncation and the `empty_turn` check, which only applies to `agent.kind === 'worker'`). A planner has
no report and no ticket, so none of that path runs for it. VS-943 does not cover this; the daemon not
having it installed is incidental.

## What Changes

- When a planner turn succeeds, wrote nothing to its plan's thread, and left final text (not a bare
  run report), the engine posts that text to the plan thread **in full**, as the planner, linked to the run.
  Same posture as VS-596's session-answer delivery.
- That fallback is recorded as a `runtime.raw` run event `run.delivery.fallback` (warn). If the post
  itself fails, the run gets a `run.delivery.failed` event (error) as well as the log line, so a lost
  answer is never silent.
- The 1000-character cap stays on the stored summary only; the posted message is never truncated.
- The turn is not re-marked failed: the answer was delivered; the events carry the fact that the
  tool path was not used.

## Capabilities

### New Capabilities
- `planner-answer-delivery`: how a planning agent's turn output reaches its plan's conversation and how a loss is made visible.

### Modified Capabilities

## Impact

`packages/core/src/runs/engine.ts` (new `deliverPlannerAnswer` after finalize) and its tests in
`engine.test.ts`. No schema, API or UI change.
