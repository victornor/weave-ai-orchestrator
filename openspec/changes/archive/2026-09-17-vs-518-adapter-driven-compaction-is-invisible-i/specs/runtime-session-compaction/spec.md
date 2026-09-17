## ADDED Requirements

### Requirement: Adapter-initiated compaction drives the same session state as the daemon path

When a runtime reports on its turn stream that it has begun compacting the session, the system SHALL
mark the agent's active session compacting and notify subscribers exactly as an out-of-band
compaction does; when the runtime reports completion, it SHALL clear the mark and notify likewise.
A runtime whose turn stream carries no compaction signal SHALL leave the session state untouched,
rather than deriving a compacting state from a context-size drop or any other heuristic.

#### Scenario: A runtime signals compaction starting

- **WHEN** a running turn's event stream carries the runtime's compaction-start signal
- **THEN** the agent's active session SHALL be marked compacting and the session-compaction notification SHALL be emitted with the compaction running

#### Scenario: A runtime signals compaction completing

- **WHEN** that turn's stream later carries the runtime's compaction-completion signal
- **THEN** the session SHALL no longer be marked compacting and the closing session-compaction notification SHALL be emitted

#### Scenario: A runtime reports no compaction signal

- **WHEN** a runtime compacts a session but its turn stream carries no compaction signal
- **THEN** the session's compaction state SHALL remain unchanged and the system SHALL NOT infer a compaction from a context-size drop

### Requirement: An adapter compaction leaves no stale context observation

After a runtime reports compacting the session during a turn, the session's stored context-size
observation SHALL NOT remain the pre-compaction size, so the automatic policy cannot start a
compaction against a session the runtime has already compacted. Where the completion signal reports
the post-compaction size, the session SHALL store that size; otherwise the observation SHALL be
cleared and a later turn's usage SHALL supply the next observation.

#### Scenario: Adapter compacts and reports the post-compaction size

- **WHEN** a runtime's compaction-completion signal reports the size after compaction
- **THEN** the session SHALL store that size as its context observation and SHALL NOT store the pre-compaction size

#### Scenario: Adapter compacts with no reported post-compaction size

- **WHEN** a runtime reports compaction but no post-compaction size
- **THEN** the session's stored context observation SHALL be cleared, and the next dispatcher tick SHALL NOT start an automatic compaction from that cleared observation
