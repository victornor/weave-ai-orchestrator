# ticket-lifecycle/direct-delivery Specification

## Purpose
Defines how a ticket reaches the status where it is delivered or finished. A ticket is transitioned
straight from the status where its work begins to the status that ends the work; `in_progress` is an
optional marker for work that spans turns, never a stepping stone the state machine forces a worker
to perform before delivering.

## Requirements

### Requirement: A finished change ticket delivers from approved

A `change` ticket SHALL be able to move from `approved` directly to `in_review`, without passing
through `in_progress`, once it has a recorded work product.

#### Scenario: a one-turn apply delivers straight to review

- **WHEN** a `change` ticket in `approved` has a recorded work product and is transitioned to `in_review`
- **THEN** the transition succeeds
- **AND** a `merge_approval` decision is raised exactly as it is for the same transition made after `in_progress`

#### Scenario: the work product is still required

- **WHEN** a `change` ticket in `approved` with no recorded work product is transitioned to `in_review`
- **THEN** the transition is rejected with error code `invalid_disposition`

### Requirement: A task may finish from todo

A `task` ticket SHALL be able to move from `todo` directly to `in_review` when it has a diff to land
and a recorded work product, or to `done` when it has nothing to land and states its ending in the
transition note, without passing through `in_progress`.

#### Scenario: a one-turn task delivers a diff

- **WHEN** a `task` ticket in `todo` with a recorded work product is transitioned to `in_review`
- **THEN** the transition succeeds and a `merge_approval` is raised

#### Scenario: a one-turn task finishes with nothing to land

- **WHEN** a `task` ticket in `todo` whose branch carries no commits missing from its landing branch is transitioned to `done` with a note stating the ending
- **THEN** the transition succeeds, no `merge_approval` is raised, and the note is recorded on the ticket

#### Scenario: the task gates are unchanged from todo

- **WHEN** a `task` ticket in `todo` is transitioned to `done` without a note, or with unlanded commits on its branch
- **THEN** the transition is rejected (error code `validation` or `worktree_not_landed` respectively), exactly as it is from `in_progress`

### Requirement: A scout, question or operational ticket may finish from todo

A `scout`, `question` or `operational` ticket SHALL be able to move from `todo` directly to `done`
without passing through `in_progress`.

#### Scenario: a one-turn scout finishes

- **WHEN** a `scout` ticket in `todo` is transitioned to `done`
- **THEN** the transition succeeds

#### Scenario: a one-turn question is answered and closed

- **WHEN** a `question` ticket in `todo` is transitioned to `done`
- **THEN** the transition succeeds

#### Scenario: an operational ticket with no action finishes

- **WHEN** an `operational` ticket in `todo` whose branch carries no commits missing from its landing branch is transitioned to `done`
- **THEN** the transition succeeds

### Requirement: in_progress remains available and optional

The `in_progress` status SHALL remain reachable from the status where each kind's work begins, and
SHALL NOT be required before a ticket is delivered or finished. A ticket that passes through
`in_progress` SHALL finish exactly as one that does not.

#### Scenario: a multi-turn apply may still mark in_progress

- **WHEN** a `change` ticket in `approved` is transitioned to `in_progress` and later to `in_review`
- **THEN** both transitions succeed

#### Scenario: skipping in_progress loses no supervision

- **WHEN** a ticket is delivered from its start status without ever entering `in_progress`
- **THEN** it was covered by the liveness rule in that status exactly as it would have been in `in_progress`

#### Scenario: the start timestamp survives the direct path

- **WHEN** a ticket first reaches a delivery status (`in_review`, `merging` or `done`) without passing through `in_progress` and has no `started_at` recorded
- **THEN** `started_at` is recorded at that transition
