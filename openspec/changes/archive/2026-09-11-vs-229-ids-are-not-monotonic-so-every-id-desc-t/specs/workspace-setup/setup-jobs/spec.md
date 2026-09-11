## ADDED Requirements

### Requirement: A project's job list is a total order of recency

Jobs listed for a project SHALL be returned most recent first as a total order of start time, then of creation. Two jobs that started in the same millisecond SHALL list with the later-created job first. The order SHALL be the same on every read of the same rows.

#### Scenario: Two jobs started in the same millisecond list in creation order

- **WHEN** two jobs for the same project are started in sequence and share a start timestamp
- **THEN** listing that project's jobs returns the later-created job first, then the earlier one
- **AND** listing them again returns the same order
