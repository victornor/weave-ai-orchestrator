## MODIFIED Requirements

### Requirement: Worker first-turn prompt does not re-paste inlined knowledge hubs

When the worker AGENTS.md already inlines the shared and project knowledge hubs, the turn prompt SHALL NOT also paste `bootstrapDigest` (SHARED.md + PROJECT.md) into the user message on first turn, nor on a stale session whose home was re-rendered this turn. On a stale session whose home was NOT re-rendered this turn, the turn prompt SHALL paste the digest, so a worker never runs against knowledge that is both stale and never refreshed. The conductor's bootstrap digest SHALL still be pasted, unconditionally, whenever the conductor's first-turn/stale-session paste already fires today. Knowledge-context recording for the run SHALL still run on every first turn or stale session, whether or not the digest is pasted into the user prompt.

#### Scenario: Worker first turn has no bootstrap paste

- **WHEN** a worker's first-turn prompt is built and AGENTS.md inlines `knowledge.shared` and `knowledge.project`
- **THEN** the prompt does not contain the bootstrap digest text of those hubs
- **AND** the run still records bootstrap knowledge-usage for those hubs

#### Scenario: Stale session with a fresh home still has no bootstrap paste

- **WHEN** a worker's session is stale and its home was re-rendered this same turn (its `AGENTS.md` already reflects current knowledge)
- **THEN** the prompt does not contain the bootstrap digest text of those hubs
- **AND** the run still records bootstrap knowledge-usage for those hubs

#### Scenario: Stale session without a fresh home gets the bootstrap paste

- **WHEN** a worker's session is stale and its home was NOT re-rendered this turn
- **THEN** the prompt contains the bootstrap digest text of the shared and project hubs
- **AND** the run still records bootstrap knowledge-usage for those hubs

#### Scenario: Conductor still gets the digest

- **WHEN** the conductor's first-turn prompt is built
- **THEN** the prompt still includes the bootstrap digest
