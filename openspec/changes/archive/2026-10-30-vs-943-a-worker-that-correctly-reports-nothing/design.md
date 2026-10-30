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

## Revision 3: truncate, don't discard

`KnowledgeReportSchema` and `RunReportSchema.summary` swap `.max(n)` for a transform that cuts to `n-1`
characters and appends `…` when longer (the limit is unchanged, so the stored value is never longer than
before). The `.refine` on `where`/`reason` presence is untouched, so a missing or empty one is still
rejected. A new `overlongReportFields(raw)` in `shared/report.ts` reads the raw payload and lists
`{field, length, limit}`; `collect_result` records them as a `runtime.raw` event with
`originalType: 'run.report.truncated'` (same carrier as `run.report.invalid`, no new enum value).

**Read back.** The stored report (`runs.result_json`, the summary shown to the weaver, the knowledge
decision) holds the truncated text with its trailing `…`. The full original is not kept in the report;
it survives in the run's `finalText`/transcript and the truncation event gives the original length. A
reader seeing `…` at exactly the limit knows it was cut.
