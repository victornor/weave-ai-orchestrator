## 1. Delivery

- [ ] 1.1 Add `deliverPlannerAnswer` in `packages/core/src/runs/engine.ts`, called after finalize: post a succeeded planner turn's full final text to its plan thread when the turn posted nothing, and record `run.delivery.fallback` / `run.delivery.failed` run events.

## 2. Tests

- [ ] 2.1 `engine.test.ts`: a planner turn with a multi-thousand-character final text and no reply call posts it in full with the fallback event (fails without the change); a turn that already replied through the tool posts nothing extra.
- [ ] 2.2 Run the engine test file and confirm it passes.
