## Why

S1 and S3 gave the built-in `weave` agent a working turn and provider profiles, but resilience is a stub: two fixed retries, a regex classifier, no timeouts other than idle, no repair of malformed tool arguments, no loop guards. Real endpoints misbehave in the ways recorded in the VS-605 probes (a gateway turning an upstream 400 into a 502 "routes failed", Z.ai numeric-string codes, OpenRouter's wrapped `Provider returned error`, DeepSeek's 402). The agent must survive those and fail with the right error family, because the engine's reaction (retry, park, pause on quota, login gate) is chosen from that family.

Reading `packages/core/src/runs/engine.ts` first turned up a real defect in the design table: `RETRYABLE = ['transient_upstream','resource']`, so a run that fails with family `resource` is re-queued by the engine. The design maps `max_steps` and `output_truncated` to `resource`, which would make a runaway agent retry itself through the engine's ladder. Those two codes must not use `resource`.

## What Changes

- Retry ladder in `retry.ts`: exponential backoff with jitter, `Retry-After` in seconds or as an HTTP date, per-failure retry caps, connect, idle and whole-request timeouts (SSE comment lines reset the idle timer), retry of a mid-stream drop before content is committed.
- Error table in `errors.ts` (one place, one fixture per row): status and body to `{code, family, retryable, maxRetries}`, with the real shapes from the probe results (OpenAI-style, Z.ai numeric-string codes and leaked Spring parse error, OpenRouter `Provider returned error` with `metadata.raw`, DeepSeek 402 and 422, gateway "routes failed after N attempts", top-level `error` inside a 200 stream, `content_filter`/`refusal`).
- `repair.ts`: malformed tool-argument repair (torn JSON, fenced, trailing commas, single-wrapped strings) and the internal `invalid` tool that hands the model a corrective result; three invalid calls in a row fail the turn `tool_call_invalid`.
- `doom.ts`: a guard that fails a turn stuck repeating the same tool call with the same arguments.
- Step, deadline and token-budget stops; recovery from `finish_reason: length` (continue once, then fail `output_truncated`).
- SSE edge cases: comment keepalives, `[DONE]` missing, empty and unparseable events, data after finish.
- `debugWire` option: redacted request and response capture to `<spillDir>/../wire/<n>.jsonl`, opt-in.
- **Fix:** `max_steps` and `output_truncated` map to family `tooling` (not retried by the engine, parks for a human); recorded in the design doc.
- Adapter maps child errors and threads `retryAfterMs` and `debugWire` through.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `builtin-agent`: adds resilience, classification, repair and guard requirements.

## Impact

`packages/agent/src/{retry,errors,repair,doom,wire,loop,sse}.ts` and `codec/chatCompletions.ts` (classifier moves out), `packages/runtimes/weave/src/{adapter,child}.ts` and `packages/shared/src/config.ts` (timeouts already exist; add `debugWire` option key), fixtures under `packages/agent/fixtures/errors/`, design docs in the knowledge base. No change to the engine.
