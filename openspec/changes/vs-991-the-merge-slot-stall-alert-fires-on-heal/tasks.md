## 1. Implementation

- [x] 1.1 Add `status`/`startedAt` to `ForgeCheck` and fill them in `GhForge.prState` (zero time dropped)
- [x] 1.2 Add pure `judgeMergeChecks` and use it in the supervisor's alarm gate
- [x] 1.3 Reword the alarm: name the check and reason, state the queue place is kept, no "hung"/re-run language

## 2. Tests

- [x] 2.1 `judgeMergeChecks` unit tests, and a `gh pr view` rollup fixture in the real shape
- [x] 2.2 Supervisor tests: slow running job (FanStack shape) no alarm and still `merging`; queued and past-limit alarm; alarm keeps queue timestamps
