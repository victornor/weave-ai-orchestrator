## ADDED Requirements

### Requirement: The worker brief and `AGENTS.md` state the plan-artifact rule when it applies

When the daemon renders a worker's brief (`renderBrief`) or worker `AGENTS.md`
(`renderWorkerInstructions`) for a `change` ticket whose plan-artifact rule is on, the rendered
guidance SHALL instruct the worker to publish a visual artifact for its plan before requesting
`proposed`, with `weave_ticket_artifact_put` under the key `plan`, and SHALL say that the artifact
supports the written plan rather than replacing it. The rendered guidance SHALL describe the artifact
as a diagram, comparison, sequence/dependency view or mock of the intended result, whichever fits.
When the ticket's rule is off, the rendered guidance SHALL NOT instruct the worker to publish a plan
artifact and SHALL read as it does today.

#### Scenario: A ticket whose rule is on is told to publish a plan artifact

- **WHEN** the daemon renders the brief or worker `AGENTS.md` for a `change` ticket whose plan-artifact rule is on
- **THEN** the rendered guidance instructs the worker to publish a plan artifact under the key `plan` before `proposed`, and says it supports rather than replaces the written plan

#### Scenario: A ticket whose rule is off is not told to

- **WHEN** the daemon renders the brief or worker `AGENTS.md` for a `change` ticket whose plan-artifact rule is off
- **THEN** the rendered guidance contains no instruction to publish a plan artifact
