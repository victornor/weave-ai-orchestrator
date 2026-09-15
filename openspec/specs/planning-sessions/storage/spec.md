# planning-sessions/storage Specification

## Purpose
Defines the persistent record of a captain's draft plans — project-scoped, pre-ticket planning
sessions and their ordered lists of draft tickets — so that closing and reopening the planning modal
always resumes the same conversations and the same lists, for one plan or several at once, never a
fresh one and never losing an unfinished one.

## Requirements

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

### Requirement: A draft ticket carries the fields needed to create a real ticket from it

Each draft in a plan SHALL carry: a title, a description, a kind (one of `change`, `task`, `scout`,
`operational`), a priority, a position determining its order in the list, zero or more dependencies on
other drafts in the same plan, a target role, and a suggested tier. A draft SHALL also carry an
optional tier override, distinct from the suggested tier, that takes precedence over it when set. A
draft SHALL NOT carry any explanatory text for its suggested tier — the tier value is the whole of it.

#### Scenario: A newly added draft has all required fields

- **WHEN** a draft is added to a plan with a title, description, kind, priority and target role
- **THEN** the stored draft carries all of those fields, plus its position in the list and no tier
  override

#### Scenario: A tier override takes precedence over the suggested tier

- **WHEN** a draft has a suggested tier of `standard` and captain sets a tier override of `deep`
- **THEN** the draft's effective tier (the one used if a ticket is created from it) is `deep`, and the
  original suggested tier remains visible on the draft alongside the override

### Requirement: A dependency between two drafts in the same plan cannot form a cycle

The system SHALL reject an attempt to make one draft in a plan depend on another draft whose own
dependencies (transitively) already include the first.

#### Scenario: A direct cycle is rejected

- **WHEN** draft A already depends on draft B, and an edit attempts to make draft B depend on draft A
- **THEN** the edit is rejected and neither draft's dependencies change

#### Scenario: An indirect cycle is rejected

- **WHEN** draft A depends on draft B, and draft B depends on draft C, and an edit attempts to make
  draft C depend on draft A
- **THEN** the edit is rejected and no draft's dependencies change

### Requirement: The planning agent runs on the weaver's own model and runtime

The system SHALL run a planning agent on the same model and runtime configured for the weaver, not on
a separate worker-tier option. There SHALL NOT be a separate, per-workspace setting for the planning
agent's model. When the weaver's configured model or runtime changes, a planning agent's subsequent
turns SHALL use the new setting.

#### Scenario: The planner uses the weaver's configured model

- **WHEN** a planning agent takes a turn
- **THEN** it runs on the model and runtime currently configured for the weaver, not a `deep` or any
  other worker-tier option

#### Scenario: A change to the weaver's model reaches the planner

- **WHEN** the workspace's configured weaver model is changed, and a planning agent (for an existing
  or a new plan) takes a turn afterward
- **THEN** that turn runs on the newly configured model

### Requirement: A planning agent reads from an isolated, disposable checkout, never the project's shared clone

Each planning agent SHALL read the project's repository from its own checkout, provisioned when the
plan starts and removed when the plan ends. It SHALL NOT read from, or share, the project's ordinary
shared clone used for fetching and for workers' own delivery.

#### Scenario: A planning agent's checkout is separate from the shared clone

- **WHEN** a planning agent is provisioned for a new plan
- **THEN** it receives its own checkout of the project's repository, distinct from the project's
  shared clone

#### Scenario: The checkout is removed when the plan ends

- **WHEN** a plan is submitted or discarded
- **THEN** its planning agent's checkout is removed

### Requirement: A draft records whether and how it became a real ticket

Once a plan is submitted, each of its drafts SHALL end up in exactly one of: still pending, linked to
the real ticket created from it, or recorded as failed with a stated reason. A draft SHALL NOT be
silently dropped with no trace of what happened to it.

#### Scenario: A draft that becomes a ticket is linked to it

- **WHEN** a real ticket is created from a draft after submission
- **THEN** that draft is recorded as linked to the created ticket's identifier

#### Scenario: A draft that cannot become a ticket records why

- **WHEN** a draft cannot be turned into a real ticket after submission (for example, no role fits)
- **THEN** that draft is recorded as failed, together with the stated reason, and remains visible in
  the plan

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
