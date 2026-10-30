## Decision

In `collect_result`, when the strict `RunReportSchema` parse yields nothing, look at the payload the
runtime returned (`result.structured`, else the last JSON candidate in `finalText`). If it parses as an
object whose `state` is a valid `REPORT_STATES` value, record `run.report.invalid` with the zod issues
and remember `reportAttempted`. `finalize` skips the VS-653 `empty_turn` failure when `reportAttempted`.

Why this key and not "called StructuredOutput": it reuses what the daemon already has, works for every
runtime (codex, opencode, text-extracted reports), and a turn that never produced a report still fails.

**Correctly waiting vs stuck.** Liveness is untouched, so an unreadable report is `empty`. In `merging`
(an action-expecting status) three consecutive empty turns with no ticket evidence raise the existing
`empty-turns:<agent>` gate finding. So a worker that keeps filing unusable reports is still caught, by
the gate and with a human-visible card, rather than by pausing it on the first turn. A worker that
files *valid* reports forever is not detected by this code and that is accepted: validity, not
repetition, is what the detector tests; supervision of a long wait belongs to the merge queue.

Rejected: exempting `merging` wholesale; relaxing `knowledge` in the schema (VS-102 decision, separate
ticket if wanted); recovering a degraded report from the invalid payload.
