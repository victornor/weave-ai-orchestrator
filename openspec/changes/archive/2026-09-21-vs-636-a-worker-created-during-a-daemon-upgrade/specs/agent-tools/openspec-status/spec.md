## ADDED Requirements

### Requirement: weave_openspec_status reports a missing worker checkout

When the ticket's live worker has no worktree (a null path, or a recorded directory that is absent),
`weave_openspec_status` SHALL report that the worker's checkout is missing and being repaired, in a
way a caller can tell apart from a change that has simply not been planned. It SHALL NOT present the
empty view of a change read against the primary clone as if the worker's planning were incomplete.

#### Scenario: A missing checkout is reported instead of an empty change

- **WHEN** `weave_openspec_status` is called for a bound ticket whose live worker has no worktree
- **THEN** the returned status names the missing worker checkout and states it is being repaired, and is distinguishable from a bound change with no planning yet

#### Scenario: A worker with a checkout is reported as before

- **WHEN** `weave_openspec_status` is called for a bound ticket whose worker has a worktree on disk
- **THEN** the status is read from the worker's worktree exactly as before this change
