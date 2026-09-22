# run-transcripts/interrupted-turn Specification

## Purpose
How every transcript surface marks a turn that was interrupted and the tool calls that were cut off with it, so a stopped turn is never mistaken for one that is still running or one that failed.

## Requirements

### Requirement: An interrupted turn is marked and its cut-off tools are not completed

When a run ends interrupted — interrupted to deliver a live human message, stopped by the daemon, or cancelled — every transcript surface SHALL render the turn as interrupted and SHALL render each tool call that produced no result as not completed, distinguishably both from a tool call that failed and from one that is still running. Partial output a runtime reported but never completed is not required to persist; the events recorded before the cut remain the turn's transcript.

#### Scenario: The turn is marked interrupted

- **WHEN** a run ends interrupted
- **THEN** its transcript marks the run as interrupted

#### Scenario: A tool cut off by the interrupt is not completed

- **WHEN** a run ends interrupted and a tool call in its events has no result
- **THEN** the transcript shows that tool call as not completed, not as failed and not as running

#### Scenario: A tool that failed before the cut is still failed

- **WHEN** an interrupted run has a tool call that produced an error result before the cut
- **THEN** it still renders as failed, not as not completed

#### Scenario: A completed turn is unaffected

- **WHEN** a run ends succeeded
- **THEN** no tool call is marked not completed
