# run-recovery Specification

## Purpose
A turn that dies mid-stream with `{"message":"The stream ended before completion.","type":"api_error"}` is recorded `failed` with `errorFamily: unknown`. `RETRYABLE` (`packages/core/src/runs/engine.ts`) is `transient_upstream` and `resource`, so the turn is lost. Six turns since 2026-10-18 (V OFM workspace), always in pairs, always the same message; the 2026-11-02 pair hit a planner, so a human mid-conversation lost their turn. The session recovered by itself minutes later: the condition is transient.
## Requirements

### Requirement: A mid-stream termination is a transient upstream failure

A runtime failure whose text says the response stream ended, closed or was terminated before completion (including the recorded `{"message":"The stream ended before completion.","type":"api_error"}`) SHALL be classified `transient_upstream` with code `stream_ended` and SHALL enter the automatic retry ladder. A failure of any other shape, including an unrecognised non-zero exit, SHALL keep its existing classification and SHALL NOT be retried because of this requirement. A usage-limit or authentication message SHALL keep its own family even if it also mentions a stream.

#### Scenario: The recorded payload is retried

- **WHEN** a turn fails with the message `The stream ended before completion.` and type `api_error`
- **THEN** the run's error family is `transient_upstream`, its code is `stream_ended`, and a retry wake is scheduled

#### Scenario: An unrelated failure is not retried

- **WHEN** a turn fails with an unrecognised error and a non-zero exit
- **THEN** its family stays `unknown` and no retry is scheduled

### Requirement: A retried stream drop is silent once and visible when it repeats

For a session, planner or conductor turn the first `stream_ended` failure in a retry chain SHALL post no notice to the conversation. A second consecutive `stream_ended` failure SHALL post one plain-language notice that the connection dropped again and the turn is being retried. A retry SHALL NOT post an answer the turn had already posted before the stream died.

#### Scenario: First drop

- **WHEN** a planner turn fails with `stream_ended` and a retry is scheduled
- **THEN** the plan thread receives no notice

#### Scenario: Second consecutive drop

- **WHEN** the retry of that turn also fails with `stream_ended` and another retry is scheduled
- **THEN** the plan thread receives exactly one notice saying the connection dropped again

#### Scenario: Answer already posted

- **WHEN** a turn posted its answer and then failed with `stream_ended`
- **THEN** the thread still holds that answer once and no failure notice is added
