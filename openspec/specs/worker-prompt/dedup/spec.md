# worker-prompt/dedup Specification

## Purpose
Stops the worker system prompt and first-turn user message from pasting the same charter and knowledge hubs twice, which wastes billed input tokens on every new worker.

## Requirements

### Requirement: Rendered worker AGENTS.md contains the charter once

The worker instruction file the daemon writes at spawn SHALL contain the role charter text exactly once. HTML comments in the worker AGENTS.md template SHALL NOT contain mustache slots (`{{charter}}`, `{{brief}}`, or any other `{{...}}`), because the template engine interpolates comments. The body SHALL NOT dump the brief object as JSON; the ticket brief lives in `brief.md`.

#### Scenario: One charter heading

- **WHEN** the daemon renders AGENTS.md for a newly spawned worker whose role has a charter
- **THEN** the file contains the charter heading exactly once
- **AND** the file does not contain a second copy of the charter inside an HTML comment

#### Scenario: Template comments are inert

- **WHEN** the shipped worker AGENTS.md template is read as source
- **THEN** no HTML comment in that file contains `{{`
- **AND** rendering that template does not expand a slot inside a comment

### Requirement: Worker first-turn prompt does not re-paste inlined knowledge hubs

When the worker AGENTS.md already inlines the shared and project knowledge hubs, the turn prompt SHALL NOT also paste `bootstrapDigest` (SHARED.md + PROJECT.md) into the user message on first turn or on a stale session. The conductor's bootstrap digest SHALL still be pasted. Knowledge-context recording for the run SHALL still run, whether or not the digest is pasted into the user prompt.

#### Scenario: Worker first turn has no bootstrap paste

- **WHEN** a worker's first-turn prompt is built and AGENTS.md inlines `knowledge.shared` and `knowledge.project`
- **THEN** the prompt does not contain the bootstrap digest text of those hubs
- **AND** the run still records bootstrap knowledge-usage for those hubs

#### Scenario: Conductor still gets the digest

- **WHEN** the conductor's first-turn prompt is built
- **THEN** the prompt still includes the bootstrap digest
