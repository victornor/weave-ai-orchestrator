## 1. Detector

- [ ] 1.1 In `finalize`, skip the `empty_turn` failure when the run has a `StructuredOutput` `tool.call` event
- [ ] 1.2 Reword the `empty_turn` failure message to what was observed

## 2. Test

- [ ] 2.1 Engine test: a `merging` ticket, a turn that calls `StructuredOutput` and nothing else stays `succeeded`, ticket stays `merging`, worker not paused
