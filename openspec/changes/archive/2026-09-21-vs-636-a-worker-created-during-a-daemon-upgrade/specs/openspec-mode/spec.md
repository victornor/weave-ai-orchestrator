## ADDED Requirements

### Requirement: The proposed gate reports a missing worker checkout as itself

When a `change` ticket requests `proposed` and the reason OpenSpec planning cannot be read is that the
ticket's live worker has no worktree (a null path, or a recorded directory that is absent), the
transition SHALL be refused with an issue stating that the worker has no worktree and that it is being
repaired. It SHALL NOT report the condition as incomplete planning, invalid planning artifacts, or an
`openspec validate` failure, because those describe a plan problem the worker cannot act on.

#### Scenario: A missing checkout is named, not blamed on the plan

- **WHEN** a bound `change` ticket whose live worker has no worktree requests `proposed`
- **THEN** the transition is refused with an issue saying the worker has no worktree and is being repaired, and the issue does not say planning is incomplete

#### Scenario: A genuine planning gap still reports planning

- **WHEN** a bound `change` ticket whose worker has a worktree requests `proposed` with incomplete artifacts
- **THEN** the refusal still reports that the planning is not complete, exactly as before
