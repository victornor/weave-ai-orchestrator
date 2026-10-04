## ADDED Requirements

### Requirement: The announcement names the runtime, the stopped agents and the exact fix

When the system stops a runtime for an expired login, the announcement it sends over the channel path and the decision it raises SHALL name the runtime, list which agents are paused (the weaver and any workers, by name), and give the login command specific to that runtime.

#### Scenario: Claude outage text
- **WHEN** the claude runtime is stopped for an expired login
- **THEN** the chat line names claude, lists the paused agents and says to run `claude /login` as the daemon's user

#### Scenario: Other runtimes
- **WHEN** a codex, cursor, gemini or opencode runtime is stopped
- **THEN** the text carries that runtime's own login command, not the claude one

### Requirement: One announcement per outage, only for authentication failures

An authentication failure that stops a runtime SHALL announce the outage once per runtime per outage, over a path that does not depend on any agent taking a turn. A run that fails for any other reason SHALL NOT gate a runtime, post a line, push, file an incident or show a banner. The repeated-failure parking path (one agent failing three times with the runtime confirmed healthy between) is a fact about that agent and keeps its own decision card.

#### Scenario: Repeated failures
- **WHEN** several runs on one runtime fail authentication during one outage
- **THEN** exactly one chat line and one push exist for it

#### Scenario: Not an authentication failure
- **WHEN** a run fails for any other family
- **THEN** no gate, chat line, push, incident or banner results

### Requirement: An outage files one incident

The system SHALL file one daemon-level incident per runtime outage, not per failing run, and SHALL resolve it when the runtime recovers.

#### Scenario: Repeated failures
- **WHEN** several runs on one runtime fail authentication during one outage
- **THEN** exactly one open incident exists for that runtime

### Requirement: Recovery is announced once

When a probe shows a gated runtime working, the system SHALL release the agents and post exactly one recovery line on the primary chat thread.

#### Scenario: Probe succeeds
- **WHEN** the recheck probe of a gated runtime succeeds
- **THEN** held runs start, the gate and card clear, and one "back" line is posted

### Requirement: The human can trigger an immediate re-check

The system SHALL provide an operator action that probes a gated runtime at once, and SHALL report whether it is still down.

#### Scenario: Fixed, then re-check
- **WHEN** the operator triggers the re-check after logging in
- **THEN** the runtime is released without waiting for the periodic tick

### Requirement: The shell shows the outage on every page

While any runtime's login is expired, the V2 shell SHALL show a banner on every page with the runtime, the fix text and a re-check control, in light and dark themes; it SHALL disappear when no runtime is gated.

#### Scenario: Banner lifecycle
- **WHEN** a credential reports `needsLogin`
- **THEN** the banner appears on all pages, and is gone once it clears

### Requirement: A probe alone does not lift the gate

The system SHALL NOT release a gated runtime because a probe described the account. It SHALL release only when a turn on that runtime succeeds, or the runtime's credential has changed since the failure and a probe then describes the account, or the operator triggers the re-check. If a runtime is gated again within 15 minutes of a probe-based release, the periodic probe SHALL stop releasing it until a turn succeeds or the operator re-checks.

#### Scenario: Probe works but the login is still expired
- **WHEN** the probe describes the account but the credential is unchanged since the failure
- **THEN** the runtime stays gated and its card stays open

#### Scenario: Release followed by another failure
- **WHEN** a probe releases the runtime and an authentication failure re-gates it within 15 minutes
- **THEN** the periodic probe no longer releases it until a turn succeeds or the operator re-checks
