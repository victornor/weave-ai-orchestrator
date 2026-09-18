## MODIFIED Requirements

### Requirement: A task with nothing to land finishes at done

A `task` ticket SHALL be able to move to `done` without a work product and without raising a `merge_approval`, provided its branch carries no commits that are missing from its landing branch. The ticket MAY be in `todo` or in `in_progress` when it does so; neither status is required.

#### Scenario: finishing a no-diff task

- **WHEN** a `task` ticket in `todo` or `in_progress` whose worktree has no commits ahead of its landing branch is transitioned to `done` with a note stating the ending and the reason
- **THEN** the transition succeeds
- **AND** no `merge_approval` decision is raised
- **AND** the stated reason is recorded on the ticket as a comment

#### Scenario: the ending must be stated

- **WHEN** a `task` ticket is transitioned to `done` without a note
- **THEN** the transition is rejected with error code `validation`
- **AND** the message names the two endings: state the ending in the note, or deliver through `in_review` when there is a diff
- **AND** non-task kinds can still transition to `done` without a note
