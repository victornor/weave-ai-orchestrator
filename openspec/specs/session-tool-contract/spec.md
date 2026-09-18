# session-tool-contract Specification

## Purpose
A runtime session is started under one set of tool definitions and holds them for its lifetime, while the daemon recomputes the tool surface on every request. That gap makes a shipped tool-contract change unreachable for any agent whose session predates it. This capability closes the gap: a session's tool contract is revalidated before each turn, and a session that would resume under a changed contract is retired so the next turn starts fresh and fetches the current definitions.

## Requirements

### Requirement: A session records the tool contract it was started under

The daemon SHALL compute, for each agent kind, a fingerprint of the tool definitions that kind's tool list exposes — every tool's name, description and input schema, including this workspace's plugin tools — and SHALL record that fingerprint on each agent session when the session is created. The fingerprint SHALL change when a parameter is added or removed, a schema changes, a tool is added or removed, or a description changes; it SHALL not depend on the order tools happen to be registered in.

#### Scenario: A parameter change moves the fingerprint

- **WHEN** a tool's input schema gains or loses a property
- **THEN** the fingerprint for the agent kinds that expose that tool differs from the fingerprint computed before the change

#### Scenario: A name-only tool list does not define the contract

- **WHEN** a tool's input schema changes while its name is unchanged
- **THEN** the fingerprint still changes

#### Scenario: Registration order does not move the fingerprint

- **WHEN** the same tool definitions are presented in a different order
- **THEN** the fingerprint is the same

#### Scenario: A plugin tool is part of the contract

- **WHEN** this workspace's plugin tools change
- **THEN** the fingerprint for every agent kind that can call them changes

### Requirement: A changed tool contract retires the session before the next turn

Before a turn spawns, the system SHALL compare the session's recorded fingerprint with the fingerprint currently computed for the agent's kind. When they differ, the system SHALL retire that session and start a new one, so the turn is not resumed and the runtime fetches the current tool definitions. When they match, the system SHALL resume the session as before. A session with no recorded fingerprint SHALL be treated as different, so a session created before this capability is retired on its next turn rather than allowed to hold a contract the daemon cannot confirm.

#### Scenario: A shipped parameter reaches a long-lived agent without a human

- **WHEN** an upgrade changes a tool's parameters and a session that predates the upgrade takes its next turn
- **THEN** the turn starts a new session, the runtime fetches the current tool list, and the agent can use the new parameter

#### Scenario: An unchanged contract still resumes

- **WHEN** a session takes a turn and the tool contract has not changed since it was recorded
- **THEN** the turn resumes the same session, and its conversation history is preserved

#### Scenario: A session predating this capability starts fresh

- **WHEN** a session has no recorded fingerprint and takes its next turn
- **THEN** the session is retired and a new one is started, rather than resumed

#### Scenario: The new session is marked as a reset

- **WHEN** a session is retired because its tool contract changed
- **THEN** the new session is treated as a first, stale session for prompt purposes, so the agent is given the fresh-session bootstrap rather than continuing as if nothing changed
