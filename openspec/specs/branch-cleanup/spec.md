# branch-cleanup Specification

## Purpose
Keep a project's remote free of merged ticket branches without ever endangering a branch that matters, and let operators opt out and clear the existing backlog.

## Requirements

### Requirement: Ticket branch deleted after confirmed merge
After the daemon confirms that a ticket's pull request merged, it SHALL delete that ticket's head branch on the remote and, if it still exists, the local branch, unless the project's `deleteBranchAfterMerge` policy is off.

#### Scenario: Merge confirmed with policy default
- **WHEN** a ticket's PR is confirmed merged and the project has not set the policy
- **THEN** the remote branch is deleted and the ticket records that it was

#### Scenario: Policy off
- **WHEN** the project sets `policies.deleteBranchAfterMerge` to false
- **THEN** no branch is deleted and no attempt is made

#### Scenario: Workspace default
- **WHEN** the project does not set the policy and the workspace default is false
- **THEN** no branch is deleted; a project value always wins over the workspace default

### Requirement: Protected branches are never deleted
The daemon SHALL NOT delete a project's default branch, its landing branch, a branch that is the head of an open pull request other than the ticket's, or a branch whose head is not contained in the merge.

#### Scenario: Default or landing branch
- **WHEN** the ticket branch name equals the default or landing branch
- **THEN** it is kept

#### Scenario: Head not contained in the merge
- **WHEN** the remote branch head differs from the merged head and is not an ancestor of the landing branch
- **THEN** it is kept and the ticket notes why

### Requirement: Cleanup never fails a landing
A failure to delete a branch SHALL be logged and noted once on the ticket, and SHALL NOT fail or roll back the landing.

#### Scenario: Forge rejects the delete
- **WHEN** the forge returns an error for the delete
- **THEN** the ticket still reaches done and carries one comment naming the failure

### Requirement: Backlog prune command
`weave project prune-branches <project> [--dry-run]` SHALL list remote branches whose ticket is done or cancelled and whose head is contained in the landing branch, and SHALL delete them only when `--dry-run` is absent.

#### Scenario: Dry run
- **WHEN** the command runs with `--dry-run`
- **THEN** it lists candidates and deletes nothing

#### Scenario: Unrelated branches
- **WHEN** a branch has no ticket, an active ticket, or an uncontained head
- **THEN** the command never lists it as a candidate

### Requirement: Policy is configurable in Settings
The project Settings SHALL expose the policy as a toggle, on by default.

#### Scenario: Toggle off
- **WHEN** a user turns the toggle off
- **THEN** the project's policies record `deleteBranchAfterMerge: false`
