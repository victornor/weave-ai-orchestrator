## 1. Engine

- [ ] 1.1 In `collect_result`, detect a report-shaped payload that fails `RunReportSchema` and record `run.report.invalid` with the issues
- [ ] 1.2 Skip the `empty_turn` failure in `finalize` when such a payload exists
- [ ] 1.3 Reword the `empty_turn` failure message to what was observed

## 2. Tests

- [ ] 2.1 `merging` ticket, structured output with `knowledge: {recorded:false}` and no reason: run `succeeded`, liveness `empty`, ticket still `merging`, worker not paused, `run.report.invalid` recorded
- [ ] 2.2 Existing inert-turn test still fails as `empty_turn`
