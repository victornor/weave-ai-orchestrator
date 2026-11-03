## 1. Classification

- [x] 1.1 Add the mid-stream termination pattern to `classifyError` (`transient_upstream`, code `stream_ended`, provider text kept), after the quota and auth checks
- [x] 1.2 Fixture holding the recorded payload plus classifier tests: recorded payload, wording variants, quota/auth-with-stream-word keep their family, unknown exit stays `unknown`
- [x] 1.3 Claude adapter test: a fake CLI whose `result` event is the recorded error yields `transient_upstream` / `stream_ended`

## 2. Retry visibility and safety

- [x] 2.1 Engine: a `stream_ended` failure that is itself a retry (chain length >= 1) is not silenced by the scheduled-retry rule for session, planner and conductor notices; one plain notice is posted
- [x] 2.2 Engine tests: stream_ended is retried (retry wake scheduled); first drop posts nothing; second posts exactly one notice; answer posted before the drop is not duplicated and gets no notice; `unknown` is not retried
