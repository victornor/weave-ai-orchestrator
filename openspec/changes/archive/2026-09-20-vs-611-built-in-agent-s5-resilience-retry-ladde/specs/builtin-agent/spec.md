## ADDED Requirements

### Requirement: Failures are classified by one table into the run error families
The agent SHALL classify every provider failure from HTTP status, body, headers, network error code and in-stream error through one table, and each row SHALL name a code, a run error family, whether it is retried and its retry cap. A 402, and a 429 or 403 whose body names insufficient quota or billing, SHALL be `provider_quota`. 401 and 403 without quota wording SHALL be `auth`. A 5xx or 400 whose message says routes failed after N attempts SHALL be `transient_upstream` with a retry cap of one. An OpenRouter `Provider returned error` SHALL be classified from its `metadata.raw` upstream body. Z.ai numeric-string codes SHALL be read. A top-level `error` inside a 200 stream SHALL be classified the same way. `finish_reason: content_filter` and `message.refusal` SHALL be `model_refusal`.

#### Scenario: Every recorded row
- **WHEN** each fixture in the error table is classified (OpenAI-style 401, unknown model, malformed JSON, DeepSeek 402 and 422, Z.ai 401/1211/1214 and the leaked parse error, OpenRouter wrapped 400 and 401, the gateway 502 and 400 "routes failed", an error object in a 200 stream, a content filter)
- **THEN** each maps to its documented code and family

#### Scenario: Quota
- **WHEN** the provider answers 402 `Insufficient Balance`
- **THEN** the turn fails `quota_exhausted` in family `provider_quota` and is not retried by the agent

#### Scenario: Gateway exhaustion is capped
- **WHEN** the provider keeps answering 502 "All available provider routes failed after 6 attempts"
- **THEN** the agent retries once, then fails, and does not retry endlessly

### Requirement: The step and output caps are not retried by the engine
A turn stopped by the step cap, the token budget or a twice-truncated output SHALL carry family `tooling`, never `resource`, because the run engine re-queues `resource` failures.

#### Scenario: Step cap
- **WHEN** the loop reaches its step cap
- **THEN** the result error is `max_steps` with family `tooling`

### Requirement: Transient failures retry on a ladder that honours the provider
The agent SHALL retry transient failures with exponential backoff and jitter, SHALL wait at least the `Retry-After` value given as seconds or as an HTTP date, SHALL surface without waiting when that value exceeds two minutes or would pass the run deadline, and SHALL retry a stream that drops before a finish reason. Connect, idle and whole-request timeouts SHALL apply, and SSE comment lines SHALL reset the idle timer.

#### Scenario: Retry-After as a date
- **WHEN** a 429 carries `Retry-After` as an HTTP date 10 seconds ahead
- **THEN** the next attempt starts no earlier than 10 seconds later

#### Scenario: 429 storm
- **WHEN** the provider answers 429 more times than the retry cap
- **THEN** the turn fails `rate_limited` in family `transient_upstream` carrying `retryAfterMs`

#### Scenario: Dropped stream
- **WHEN** the connection closes mid-stream before a finish reason
- **THEN** the step is retried and the completed step is the one recorded

#### Scenario: Stall and keepalive
- **WHEN** the provider sends no bytes for the idle window
- **THEN** the attempt fails as a timeout; and when it sends only comment lines, the idle timer keeps resetting

### Requirement: Malformed tool arguments are repaired or corrected
The agent SHALL repair tool-call arguments that are torn, fenced, or have trailing commas, and SHALL otherwise answer the call with a corrective result through an `invalid` path without executing anything. Three consecutive invalid calls SHALL fail the turn `tool_call_invalid`.

#### Scenario: Torn JSON
- **WHEN** a call's arguments are `{"path":"a.txt"`
- **THEN** the call runs with `path` `a.txt`

#### Scenario: Unrepairable
- **WHEN** a call's arguments cannot be repaired
- **THEN** the model receives a corrective result naming the tool and the parse error, and no tool runs

### Requirement: A repeating tool call is stopped
The agent SHALL refuse a fourth identical tool call (same name and arguments, same results) once with a corrective result and SHALL fail the turn `doom_loop` if it repeats again.

#### Scenario: Doom loop
- **WHEN** the model issues the same call with the same result four times and again after the warning
- **THEN** the turn fails `doom_loop` in family `tooling`

### Requirement: Output truncation is recovered once
When a step ends `finish_reason: length` with text and no tool call, the agent SHALL ask the model to continue once; a second truncation in the turn SHALL fail `output_truncated` in family `tooling`.

#### Scenario: Recovered
- **WHEN** the first step ends `length` and the continuation ends `stop`
- **THEN** the turn completes with both texts in the session

### Requirement: Duplicate indices and missing ids do not break assembly
The tool-call assembler SHALL synthesise an id for a call the provider sent without one, and SHALL keep two parallel calls apart when a provider reuses an index with different ids.

#### Scenario: Missing id
- **WHEN** a tool call arrives with no `id`
- **THEN** it runs under a generated id and its result pairs with it

### Requirement: debugWire capture is opt-in and redacted
With `debugWire` set, the agent SHALL write each request and response to a wire file outside the worktree. No provider key, authorization header or tool environment value SHALL appear in it. Without the option nothing SHALL be written.

#### Scenario: No secret
- **WHEN** a turn runs with `debugWire` and a provider key
- **THEN** the wire file exists and contains neither the key nor any authorization header value
