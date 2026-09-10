## ADDED Requirements

### Requirement: Global Live cells collapse consecutive tool calls as per-workspace Live does

A global Live cell SHALL collapse consecutive identical tool names in its streamed transcript the
same way a per-workspace Live cell does (`workspace-navigation/live-floor`): consecutive same-name
calls become one counted expandable row, a mixed sequence stays separate groups, and a single call
is not counted.

#### Scenario: Ten consecutive Reads collapse on global Live

- **WHEN** a live worker's in-progress run records ten consecutive Read tool calls and global Live
  is open
- **THEN** that worker's cell shows one counted Read row, not ten separate rows

#### Scenario: A mixed sequence stays three groups on global Live

- **WHEN** that run is Read, then Glob, then Read
- **THEN** the cell shows three groups
