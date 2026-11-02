## 1. Delivery

- [ ] 1.1 Add `deliverPlannerAnswer` in `packages/core/src/runs/engine.ts`, called after finalize: post a succeeded planner turn's full final text to its plan thread when the turn posted nothing, and record `run.delivery.fallback` / `run.delivery.failed` run events.
- [ ] 1.2 For a planner turn that ends `timed_out`, `cancelled`, `interrupted` or `failed`, post `sessionOutcomeNotice` to the plan thread with VS-598's silences (scheduled retry, shutdown / live-message interruption, auth family handled as for sessions, already-posted run).

## 2. Tests

- [ ] 2.1 `engine.test.ts`: a planner turn with a multi-thousand-character final text and no reply call posts it in full with the fallback event (fails without the change); a turn that already replied through the tool posts nothing extra; a timed-out turn leaves a notice; a failed turn with a scheduled retry and a shutdown-interrupted turn leave none.
- [ ] 2.2 Run the engine test file and confirm it passes.
