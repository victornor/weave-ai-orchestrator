## Why

A turn that dies mid-stream with `{"message":"The stream ended before completion.","type":"api_error"}` is recorded `failed` with `errorFamily: unknown`. `RETRYABLE` (`packages/core/src/runs/engine.ts`) is `transient_upstream` and `resource`, so the turn is lost. Six turns since 2026-10-18 (V OFM workspace), always in pairs, always the same message; the 2026-11-02 pair hit a planner, so a human mid-conversation lost their turn. The session recovered by itself minutes later: the condition is transient.

Cause: `classifyError` (`packages/runtime-sdk/src/process.ts`) knows no pattern for it, so it falls to `exit_N` / `unknown`. For the claude runtime the text arrives in the `result` event (`is_error`, `result` = the JSON above), which `events.ts` records as `errorMessage` and the adapter feeds to `classifyError`.

## What Changes

- `classifyError` classifies a stream that ended before the response completed as `transient_upstream` with code `stream_ended`, keeping the provider's text as the message. Matching is on the shape of the failure (a stream/connection/response that ended, closed, terminated or was cut before completion, premature close, incomplete chunked read), not on one provider's sentence, and only after the quota and auth patterns so a limit or login message that also mentions a stream is still read as that.
- The existing retry ladder (30 s / 2 min / 10 min, max 3) then retries it. Nothing else in the ladder changes; `unknown` stays unretried.
- Retry visibility: the first drop is silent (the existing "scheduled retry posts no notice" rule). A second consecutive `stream_ended` failure in the same retry chain is no longer silent for session, planner and conductor turns: the thread gets one plain notice that the connection dropped again and the daemon is retrying.
- Safety, bounded and asserted: a retried planner/session turn reuses the retry wake's thread context and never posts twice for the same run (`hasOutboundForRun`); a retried worker turn resumes its session, as every other transient retry does. A reply the agent already posted before the stream died is not posted again and the failure notice is not added on top of it.
- Not done: no structural "no terminal event" detection. The recorded case does carry a terminal `result` event (an error one), and a non-zero exit without one is indistinguishable from a crash or a cancel, which must stay `unknown`. Stated here so a reviewer can disagree.

## Capabilities

### Modified Capabilities
- `run-recovery`: a mid-stream termination is a retryable transient failure, visible to the human only when it repeats.

## Impact

`packages/runtime-sdk/src/process.ts` (+ test, + fixture of the recorded payload), `packages/core/src/runs/engine.ts` (+ tests). No schema, API or enum change.
