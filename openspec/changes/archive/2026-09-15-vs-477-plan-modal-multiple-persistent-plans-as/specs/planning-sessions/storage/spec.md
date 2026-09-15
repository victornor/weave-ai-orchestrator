# planning-sessions/storage — delta

## REMOVED Requirements

### Requirement: A project has at most one draft plan in progress at a time

**Reason**: Replaced. Captain needs several plans in development at once, shown as tabs, and a
project is now allowed to hold more than one `drafting` plan.

**Migration**: No data change. Existing projects already hold at most one `drafting` plan; the
partial unique index `plans_one_drafting_per_project` is dropped. `POST /projects/:id/plans/start`
keeps its resume-or-create contract, now resuming the most recent `drafting` plan.

## MODIFIED Requirements

### Requirement: A draft plan persists across the modal closing and reopening

The system SHALL persist a plan's conversation and its draft list independently of whether the
planning modal is open and independently of which of the project's plan tabs is focused. Closing the
modal, switching to another plan's tab, and opening the modal again on another device SHALL NOT
discard or alter any plan.

#### Scenario: Reopening after closing shows the same state

- **WHEN** captain closes the Plan modal with a `drafting` plan containing drafts, then reopens it
  later
- **THEN** the same conversation history and the same drafts, in the same order, are shown for that
  plan

#### Scenario: Switching between two plans leaves each unchanged

- **WHEN** captain has two `drafting` plans, edits a draft in the first, switches to the second, and
  switches back
- **THEN** the first plan still shows the edited draft and its own conversation, and the second
  plan's conversation and drafts are unchanged by the visit

#### Scenario: Another device shows the same plans

- **WHEN** captain opens the Plan modal for a project on a second device
- **THEN** the same drafting plans are listed and each shows the same conversation history and
  drafts as on the first device

## ADDED Requirements

### Requirement: A project may have several draft plans in progress at once

The system SHALL allow a project to have more than one plan in the `drafting` status at the same
time. Creating a new drafting plan SHALL NOT alter, discard or submit any other drafting plan.

#### Scenario: Two planning sessions coexist

- **WHEN** captain creates a drafting plan for a project that already has a drafting plan
- **THEN** both plans exist in `drafting` status, each with its own conversation and draft list

#### Scenario: Starting resumes the most recent draft plan

- **WHEN** a start request arrives for a project that has one or more drafting plans
- **THEN** the most recently created drafting plan is returned rather than a new one being created

#### Scenario: Discarding one plan leaves the other untouched

- **WHEN** captain discards one of a project's drafting plans
- **THEN** that plan becomes `discarded`, the project's other drafting plans keep their status,
  conversation and drafts, and no tickets are created for the discarded plan

#### Scenario: A submitted or discarded plan does not block a new one

- **WHEN** a project's prior plans are all `submitted` or `discarded`, and captain starts a new plan
- **THEN** a new plan is created in `drafting` status and the prior plans remain as history

### Requirement: A project's drafting plans can be listed as tab summaries

The system SHALL be able to return a project's `drafting` plans, newest first, each with at least its
id, title, status, draft count, creation time and last-updated time, so a client can render a tab per
plan without loading every plan's full conversation.

#### Scenario: The list returns every drafting plan, newest first

- **WHEN** a project has two drafting plans, the second created after the first
- **THEN** the list returns both, the newer one first, each carrying its current title, status and
  draft count

#### Scenario: Submitted and discarded plans are not tab summaries

- **WHEN** a project's plans are one `drafting`, one `submitted` and one `discarded`
- **THEN** the drafting-plan list contains only the `drafting` plan, while the submitted and
  discarded plans remain readable as history

### Requirement: A plan's title records whether it was auto-generated or given by captain

A plan SHALL store, alongside its title, whether the title was auto-generated or supplied by
captain. An auto-generated title SHALL never replace a title captain supplied. A title that is still
auto-generated MAY be replaced by a later auto-generated title.

#### Scenario: An auto title is stored and flagged

- **WHEN** an auto-generated title is stored on a plan that had none
- **THEN** the plan carries that title with its source recorded as auto-generated

#### Scenario: Captain's rename is never overwritten

- **WHEN** captain renames a plan, and an auto-generated title is later offered for that plan
- **THEN** the plan keeps captain's title and the auto-generated title is discarded

#### Scenario: An auto title may be regenerated while it is still auto

- **WHEN** a plan's title is still auto-generated and a new auto-generated title is stored
- **THEN** the plan's title becomes the new one

### Requirement: A drafting plan's planner is live while its tab is focused and retires when idle

The system SHALL ensure a live planning agent for a drafting plan when its tab is focused, and SHALL
retire a planning agent that has been idle beyond an inactivity threshold, removing its disposable
checkout, so that several drafting plans do not hold unbounded planner resources. Retirement SHALL
NOT discard the plan, its conversation or its drafts: focusing the tab again ensures a planner again
and the conversation and drafts are read from storage. A planner SHALL NOT be retired while it has a
turn running, and ensuring a planner SHALL NOT bypass the daemon's run limits.

#### Scenario: Focusing a tab ensures its planner

- **WHEN** captain focuses a drafting plan's tab
- **THEN** that plan has a live planner agent, whether it was already live or is provisioned fresh

#### Scenario: An idle planner is retired without losing the plan

- **WHEN** a drafting plan's tab has not been focused and its planner has taken no turn for longer
  than the inactivity threshold
- **THEN** its planner is retired and its disposable checkout removed, while the plan, its
  conversation and its drafts remain readable

#### Scenario: A retired planner's plan resumes on reopening

- **WHEN** captain focuses again the tab of a plan whose planner was retired
- **THEN** a planner is ensured again for that plan and the plan's stored conversation and drafts are
  shown

#### Scenario: A planner with a running turn is not retired

- **WHEN** an inactivity sweep considers a planner whose turn is currently running
- **THEN** that planner is left alone until the turn finishes
