## Purpose
A planning agent talks to captain only through its plan's conversation. This capability keeps a planner's answer from being lost when the agent finishes a turn without using its reply tool, and makes any loss visible instead of reporting a quiet success.

## ADDED Requirements

### Requirement: A planner's final text reaches the plan conversation in full

When a planning agent's turn succeeds, posted no message to its plan's thread, and ended with non-empty final text that is not a structured run report, the system SHALL post that text to the plan's thread as the planner, linked to the run, without truncating it. The stored run summary MAY be capped.

#### Scenario: A long answer written as closing prose is posted

- **WHEN** a planner turn succeeds with a 5000-character final text and no `weave_plan_reply` call
- **THEN** the plan thread gains one message from the planner with the full 5000 characters, carrying the run id

#### Scenario: A turn that already replied is not duplicated

- **WHEN** a planner turn posted a message to the plan thread through its reply tool
- **THEN** the system posts nothing further for that turn

#### Scenario: A turn with no final text posts nothing

- **WHEN** a planner turn succeeds having only run tools and left no final text
- **THEN** nothing is posted and no delivery event is recorded

### Requirement: A planner turn that ends without an answer says so

When a planning agent's turn ends `timed_out`, `cancelled`, `interrupted` or `failed` and posted nothing to its plan's thread, the system SHALL post the same plain-reason system notice a persistent session turn receives. It SHALL stay silent when the daemon will retry or resume the turn (a scheduled retry, a shutdown interruption, an interruption by a live message), and SHALL NOT post when the turn already wrote to the thread.

#### Scenario: A timed-out planner turn leaves a notice

- **WHEN** a planner turn ends `timed_out` with nothing posted and no retry scheduled
- **THEN** the plan thread gains a system message saying the turn took too long and was stopped before it could answer

#### Scenario: A retried failure is not announced

- **WHEN** a planner turn fails and a retry is scheduled
- **THEN** nothing is posted for that run

#### Scenario: A shutdown interruption is not announced

- **WHEN** a planner turn is interrupted by a daemon shutdown
- **THEN** nothing is posted for that run

### Requirement: A fallback or failed planner delivery is recorded

The system SHALL record a run event `run.delivery.fallback` whenever it posts a planner's final text on the agent's behalf, and `run.delivery.failed` when that post fails.

#### Scenario: Fallback is recorded

- **WHEN** the engine posts a planner's final text because the reply tool was not used
- **THEN** the run has a `run.delivery.fallback` event stating the character count

#### Scenario: A failed post is recorded

- **WHEN** posting the final text to the plan thread throws
- **THEN** the run has a `run.delivery.failed` event with the error, and the finished run is not otherwise altered
