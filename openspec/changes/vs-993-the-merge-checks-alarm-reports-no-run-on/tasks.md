## 1. Implementation

- [ ] 1.1 Persist `ciHeadAt` in the supervisor's merge-slot poll (reset on head change, backfilled when missing)
- [ ] 1.2 `judgeMergeChecks` takes `headObservedAtMs`; empty/none-pending rollup is `no_run` only after the grace from max(slot start, head observed)
- [ ] 1.3 Pass `ciHeadAt` from the supervisor into the judge

## 2. Tests

- [ ] 2.1 `judgeMergeChecks`: slot held long, head observed seconds ago, no checks → no alarm; head without checks past grace → `no_run`
- [ ] 2.2 Supervisor: head change mid-landing resets `ciHeadAt` and does not alarm; a stale head without checks alarms
