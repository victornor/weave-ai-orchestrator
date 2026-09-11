# ticket-lifecycle/task-completion Specification

## Purpose
Defines how a `task` ticket ends. Today the contract routes every task to `in_review`, so even a task whose whole output is a config tweak raises a PR and a merge approval. A task worker chooses its ending from what it produced: a reviewable diff goes to `in_review` as before; nothing that needs landing finishes at `done` — and the guard that keeps that lighter path honest is enforced by the daemon, not narrated.

## Requirements

### Requirement: A task with nothing to land finishes at done

A `task` ticket SHALL be able to move to `done` without a work product and without raising a `merge_approval`, provided its branch carries no commits that are missing from its landing branch.

#### Scenario: finishing a no-diff task

- **WHEN** a `task` ticket in `in_progress` whose worktree has no commits ahead of its landing branch is transitioned to `done` with a note stating the ending and the reason
- **THEN** the transition succeeds
- **AND** no `merge_approval` decision is raised
- **AND** the stated reason is recorded on the ticket as a comment

#### Scenario: the ending must be stated

- **WHEN** a `task` ticket is transitioned to `done` without a note
- **THEN** the transition is rejected with error code `validation`
- **AND** the message names the two endings: state the ending in the note, or deliver through `in_review` when there is a diff
- **AND** non-task kinds can still transition to `done` without a note

### Requirement: done is refused when the branch carries unlanded commits

A `task` ticket SHALL NOT be transitioned to `done` while its branch carries commits that are not contained in its landing branch — by ancestry or by patch-id equivalence — regardless of the transitioning actor.

#### Scenario: commits on the branch

- **WHEN** the ticket's branch has commits that are not contained in its landing branch and a transition to `done` is requested
- **THEN** the transition is rejected with error code `worktree_not_landed`
- **AND** the error names `in_review` as the route for work that should land
- **AND** the ticket keeps its previous status

#### Scenario: a squash-merged branch counts as landed

- **WHEN** every commit on the ticket's branch has a patch-id equivalent in the landing branch (for example after a squash merge)
- **THEN** a transition to `done` is not refused for unlanded commits

#### Scenario: no worktree does not block

- **WHEN** the ticket has no worktree, or the worktree cannot be read
- **THEN** a transition to `done` is not refused for unlanded commits

### Requirement: a reviewable diff still delivers through in_review

The existing `task` delivery path SHALL be unchanged: a task that produced commits is delivered at `in_review` with a recorded work product, raises a `merge_approval` for the human, and merges through the merge queue to `done`.

#### Scenario: a task with a diff keeps today's path

- **WHEN** a `task` ticket's branch carries commits not contained in its landing branch
- **THEN** transitioning to `in_review` with a work product succeeds and raises a `merge_approval`
- **AND** after the merge is approved and `ac_ticket_merge_done` is accepted, the ticket is `done` without being refused by the unlanded-commit guard

### Requirement: other kinds are unaffected

The done gate SHALL apply only to `task` tickets; `change`, `scout` and `question` behaviour is unchanged.

#### Scenario: scout and question endings are untouched

- **WHEN** a `scout` or `question` ticket finishes at `done`
- **THEN** no note requirement and no unlanded-commit check apply

#### Scenario: the change flow is untouched

- **WHEN** a `change` ticket moves through propose, apply, `in_review`, `merging` and the post-merge `done`
- **THEN** every gate it passes is the same as before this change
