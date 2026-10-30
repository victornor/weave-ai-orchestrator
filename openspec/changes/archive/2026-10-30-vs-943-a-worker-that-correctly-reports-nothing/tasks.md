## 1. Engine

- [x] 1.1 In `collect_result`, detect a report-shaped payload that fails `RunReportSchema` and record `run.report.invalid` with the issues
- [x] 1.2 Skip the `empty_turn` failure in `finalize` when such a payload exists
- [x] 1.3 Reword the `empty_turn` failure message to what was observed

## 2. Tests

- [x] 2.1 `merging` ticket, structured output with `knowledge: {recorded:false}` and no reason: run `succeeded`, liveness `empty`, ticket still `merging`, worker not paused, `run.report.invalid` recorded
- [x] 2.2 Existing inert-turn test still fails as `empty_turn`

## 3. Root fix: truncate over-long fields

- [x] 3.1 `RunReportSchema` truncates over-long `summary`, `knowledge.where`, `knowledge.reason` (ending in `…`) instead of rejecting; shape/presence rules unchanged
- [x] 3.2 Record `run.report.truncated` (field, original length, limit) when the engine accepts a truncated report
- [x] 3.3 Tests: 220-char reason accepted and truncated; missing reason still rejected; truncation event recorded
