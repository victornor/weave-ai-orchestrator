## ADDED Requirements

## Purpose
A planning agent talks to captain only through its plan's conversation. This capability keeps a planner's answer from being lost when the agent finishes a turn without using its reply tool, and makes any loss visible instead of reporting a quiet success.

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

### Requirement: A fallback or failed planner delivery is recorded

The system SHALL record a run event `run.delivery.fallback` whenever it posts a planner's final text on the agent's behalf, and `run.delivery.failed` when that post fails.

#### Scenario: Fallback is recorded

- **WHEN** the engine posts a planner's final text because the reply tool was not used
- **THEN** the run has a `run.delivery.fallback` event stating the character count

#### Scenario: A failed post is recorded

- **WHEN** posting the final text to the plan thread throws
- **THEN** the run has a `run.delivery.failed` event with the error, and the finished run is not otherwise altered
