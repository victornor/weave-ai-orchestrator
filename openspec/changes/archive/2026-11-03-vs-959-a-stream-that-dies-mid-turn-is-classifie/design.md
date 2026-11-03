## Context

`classifyError(exitCode, text)` is the shared text classifier every adapter calls; claude passes `result.result` (the error JSON) plus stderr. Retries are the engine's ladder keyed on `RETRYABLE` families. Session/planner/conductor failure notices are suppressed whenever `run.scheduledRetryAt` is set (`sessionOutcomeNotice`).

## Decisions

- **Text shape, not exact sentence.** One regex over "stream/connection/response ended|closed|terminated|cut|dropped … before completion/finish/final", plus `premature close`, `incomplete chunked`, `terminated unexpectedly`. Placed after the quota and auth patterns, before nothing else, so a limit or login message keeps its family. Checked: no runtime offers a structured "stream cut" code on this path; claude's `api_error_status` is not set for it.
- **No structural no-terminal-event rule.** The recorded failure has a terminal (error) `result` event; a non-zero exit with no result is indistinguishable from a crash or cancel, which must stay `unknown` (the ticket says leave unknown unretried). Rejected.
- **Code `stream_ended`, family `transient_upstream`.** Keeps the retry ladder, backoff and exhaustion card unchanged. The provider text is kept as the message for diagnosis.
- **Retry safety.** Worker: the retry resumes the same session, as for any transient failure; side effects before the drop are in the session transcript, so nothing is replayed blind. Session/planner/conductor: the retry wake carries thread and message ids; `hasOutboundForRun` prevents a second post for the same run; an answer posted before the drop is not duplicated. Retry count stays bounded by the existing three-attempt ladder.
- **Visibility.** First drop silent (existing rule). When the failing run is itself a retry (`countRetries >= 1`) and its code is `stream_ended`, the scheduled-retry silence is lifted for that notice and one plain line is posted ("The connection to the model dropped again; retrying."). Implemented as a small helper used by the three notice callers, not a change to `sessionOutcomeNotice`'s other cases.

## Risks

A regex can over-match a tool's own output containing such a phrase; the classifier only sees the runtime error text and stderr of a failed turn, so a false match costs one retry, not data.
