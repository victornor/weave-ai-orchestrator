# planning-sessions/v2-modal Specification

## Purpose
Defines how captain reaches and uses the planning conversation from V2 chat: the entry point, the
modal/sheet surface it opens, and how the live draft list behaves as captain and the planning agent
both edit it.

## Requirements

### Requirement: A Plan entry point sits in the V2 chat composer's toolbar

The V2 chat composer's toolbar SHALL include a control labelled **"Plan"** that opens the planning
surface for the current project, positioned beside the existing search control. Secondary copy
elsewhere (descriptions, documentation, tool text) MAY refer to the underlying concept as a "draft
plan" or "planning session," but this control's own label SHALL remain "Plan."

#### Scenario: The Plan control is present

- **WHEN** captain views the V2 chat composer's toolbar
- **THEN** a control labelled "Plan" is present beside the search control

#### Scenario: The Plan control opens the planning surface

- **WHEN** captain activates the Plan control
- **THEN** the planning surface opens for the current project

### Requirement: The planning surface is a modal on desktop and a full-screen sheet on phone

On a desktop-sized viewport, the planning surface SHALL present as a modal. On a phone-sized viewport,
it SHALL present as a full-screen sheet.

#### Scenario: Desktop shows a modal

- **WHEN** captain opens the planning surface on a desktop-sized viewport
- **THEN** it presents as a modal over the current page, not a full-screen takeover

#### Scenario: Phone shows a full-screen sheet

- **WHEN** captain opens the planning surface on a phone-sized viewport
- **THEN** it presents as a full-screen sheet

### Requirement: The planning surface shows the conversation and the draft list together

The planning surface SHALL show the conversation with the planning agent and the current draft list at
the same time, so captain can see the effect of the conversation on the list without switching views.

#### Scenario: Both panes are visible together on desktop

- **WHEN** captain has the planning surface open on a desktop-sized viewport with drafts in the plan
- **THEN** the conversation and the draft list are both visible without further navigation

### Requirement: Captain can pick the plan's project, defaulting to the current one

The planning surface SHALL let captain choose which project the plan belongs to, defaulting to the
project of the chat the Plan control was opened from.

#### Scenario: Opening from a project's chat defaults to that project

- **WHEN** captain opens the planning surface from a chat scoped to a specific project
- **THEN** the plan defaults to that project

#### Scenario: Captain can change the project before drafting

- **WHEN** captain changes the plan's project selection before any drafts exist
- **THEN** the plan is scoped to the newly selected project

### Requirement: Captain can edit any field of any draft, including the tier

Captain SHALL be able to edit every field of a draft directly in the list — including overriding its
suggested tier — independent of the conversation.

#### Scenario: Editing a draft's field directly

- **WHEN** captain edits a draft's title, description, kind, priority, role, or order directly in the
  list
- **THEN** the draft reflects the edited value

#### Scenario: Overriding the suggested tier

- **WHEN** captain sets a tier override on a draft whose suggested tier differs
- **THEN** the draft shows both the original suggested tier and the override, with the override marked
  as what will actually be used

### Requirement: Submit is unavailable with no drafts

The planning surface SHALL prevent submitting a plan that has no drafts.

#### Scenario: Submit is disabled with an empty plan

- **WHEN** captain has a plan with zero drafts open in the planning surface
- **THEN** the submit action is unavailable

#### Scenario: Submit becomes available once a draft exists

- **WHEN** captain adds at least one draft to a plan that previously had none
- **THEN** the submit action becomes available

### Requirement: The draft list updates live as either side changes it

The draft list SHALL reflect changes made by the planning agent during the conversation and changes
made directly by captain, without requiring a manual reload.

#### Scenario: An agent-added draft appears without reloading

- **WHEN** the planning agent adds a draft during the conversation
- **THEN** the draft appears in captain's view of the list without captain reloading the page

#### Scenario: A captain-made edit is reflected without reloading

- **WHEN** captain edits a draft directly while the planning agent is composing a reply
- **THEN** the edit is visible in captain's own view immediately, and remains applied once the reply
  arrives

### Requirement: The planning surface never widens to fit a child

The planning surface SHALL constrain the width of its conversation pane so that no child — the
dictation meter or any other — can widen the pane or the surface beyond the surface's own laid-out
size. A child that cannot fit SHALL be clipped or scrolled inside the pane, not allowed to grow it.

#### Scenario: Listening does not widen the pane

- **WHEN** captain starts dictation in the planning surface's composer
- **THEN** the conversation pane and the planning surface keep the widths they had before dictation
  started

#### Scenario: The pane is width-constrained

- **WHEN** the conversation pane contains a child wider than the pane
- **THEN** the child is contained by the pane rather than expanding it
