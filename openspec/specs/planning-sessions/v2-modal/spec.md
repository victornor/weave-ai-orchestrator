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

The planning surface SHALL let captain choose which project the surface is showing, defaulting to the
project of the chat the Plan control was opened from. Each project's plans are shown as that
project's own tabs; switching the selected project SHALL show that project's drafting plans and SHALL
NOT create or discard a plan in either project.

#### Scenario: Opening from a project's chat defaults to that project

- **WHEN** captain opens the planning surface from a chat scoped to a specific project
- **THEN** the surface shows that project's drafting plans

#### Scenario: Switching project shows that project's plans

- **WHEN** captain changes the selected project
- **THEN** the surface shows the newly selected project's drafting plans and tabs, and the previously
  shown project's plans are unchanged

#### Scenario: Captain can change the project before drafting

- **WHEN** captain changes the plan's project selection before any drafts exist in the currently
  focused plan
- **THEN** the surface shows the newly selected project's drafting plans, and the newly selected
  project's own drafting plan is the one drafted into

#### Scenario: A project with no drafting plan shows the empty state

- **WHEN** captain selects a project that has no drafting plan
- **THEN** the surface shows an empty state offering to start a new plan, and no plan is created
  until captain asks for one

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

### Requirement: The planning surface shows one tab per drafting plan

The planning surface SHALL show one tab for each of the selected project's `drafting` plans,
persisted server-side so the set of tabs survives a page reload and is the same on another device.
The surface SHALL mark which tab is focused.

#### Scenario: A tab per drafting plan

- **WHEN** the selected project has three drafting plans
- **THEN** the surface shows three tabs, one per plan, with the focused one marked

#### Scenario: Tabs survive a reload

- **WHEN** captain has two drafting plans open as tabs and reloads the page
- **THEN** the same two tabs are shown, still one per plan

#### Scenario: Submitting a plan closes its tab and keeps the others

- **WHEN** captain submits one of several drafting plans
- **THEN** that plan's tab is gone, its other tabs remain, and the surface focuses one of them

### Requirement: Captain can start a new plan from the surface

The planning surface SHALL provide a **New plan** control that creates a fresh drafting plan for the
selected project, with its own conversation and planner, and focuses its tab. A project SHALL be
allowed to hold several drafting plans at once.

#### Scenario: New plan adds and focuses a tab

- **WHEN** captain activates **New plan** while a drafting plan's tab is focused
- **THEN** a new drafting plan is created, a new tab appears for it, and that tab is focused with an
  empty conversation

#### Scenario: New plan leaves the other plans alone

- **WHEN** captain activates **New plan** while another drafting plan has drafts
- **THEN** the earlier plan keeps its conversation and drafts and remains available as a tab

### Requirement: Switching tabs changes the plan the surface shows

Activating a plan's tab SHALL switch the surface's conversation, draft list and planner to that plan.
The switch SHALL NOT submit, discard or otherwise change either plan.

#### Scenario: Switching loads that plan's conversation and drafts

- **WHEN** captain activates the tab of another drafting plan
- **THEN** the conversation and draft list shown become that plan's, and the composer sends messages
  to that plan's planner

#### Scenario: Switching does not change the plan left behind

- **WHEN** captain switches away from a plan and back
- **THEN** the plan's drafts and conversation are as they were, unchanged by the visits

### Requirement: Captain can delete a drafting plan without executing it

Each plan tab SHALL offer a delete control that asks for confirmation before deleting. Confirming
SHALL discard that plan only — its status becomes `discarded`, its planner is retired, and no tickets
are created from it — while its plan and conversation are kept as history and the project's other
drafting plans are untouched. Deleting the last remaining tab SHALL leave the empty state.

#### Scenario: Delete asks for confirmation

- **WHEN** captain activates a tab's delete control
- **THEN** a confirmation is shown, and the plan is not deleted unless captain confirms

#### Scenario: Confirming deletes only that plan and no tickets exist for it

- **WHEN** captain confirms deleting one of several drafting plans
- **THEN** that plan is discarded and its tab is gone, no tickets are created from it, and the other
  drafting plans remain with their conversations and drafts

#### Scenario: Deleting the last tab leaves the empty state

- **WHEN** captain deletes the project's only drafting plan
- **THEN** the surface shows the empty state offering to start a new plan

#### Scenario: Cancelling the confirmation keeps the plan

- **WHEN** captain dismisses the delete confirmation without confirming
- **THEN** the plan's tab remains and the plan is unchanged

### Requirement: A plan tab shows its title, or a placeholder until one exists

A plan's tab SHALL show the plan's title when it has one and the placeholder **New plan** while it has
none. Captain SHALL be able to rename a plan by double-clicking its tab and entering a title; a
renamed title SHALL persist server-side and SHALL NOT be replaced by a later auto-generated title.

#### Scenario: A titled plan shows its title

- **WHEN** a drafting plan has a title
- **THEN** its tab shows that title

#### Scenario: An untitled plan shows the placeholder

- **WHEN** a drafting plan has no title yet
- **THEN** its tab shows "New plan"

#### Scenario: Double-click renames the tab

- **WHEN** captain double-clicks a plan's tab, enters a title and confirms
- **THEN** the tab shows the entered title and the title is stored on the plan

### Requirement: The last-focused plan tab is remembered on the device

The planning surface SHALL remember, on the device, which plan tab captain last focused for a
project, and SHALL focus that tab when the surface is next opened for that project, when that plan is
still a drafting plan. When the remembered plan is gone, the surface SHALL focus another of the
project's drafting plans, or the empty state when there are none.

#### Scenario: Reopening focuses the last-focused tab

- **WHEN** captain focuses a plan tab, closes the surface, and opens it again for the same project
- **THEN** that same plan's tab is focused

#### Scenario: A remembered plan that is gone falls back

- **WHEN** the plan remembered for a project has been submitted or discarded, and the surface is
  opened for that project
- **THEN** the surface focuses another of the project's drafting plans, or the empty state when none
  remains

### Requirement: A scout draft in a drafting plan can be dispatched from the planning surface

Each `scout` draft in a `drafting` plan SHALL show a **Dispatch** action in the planning surface,
available only for that draft kind and only while its plan is `drafting` and the draft has not already
been dispatched. Activating it starts that scout's ticket without submitting the rest of the plan.

#### Scenario: The dispatch action is shown for a scout draft

- **WHEN** captain views a `scout` draft in a `drafting` plan that has not yet been dispatched
- **THEN** a Dispatch action is shown for that draft

#### Scenario: The dispatch action is not shown for other draft kinds

- **WHEN** captain views a `change`, `task`, or `operational` draft
- **THEN** no dispatch action is shown for it

#### Scenario: Dispatching starts the scout without affecting other drafts

- **WHEN** captain activates the Dispatch action on a scout draft
- **THEN** that draft's ticket starts running, and every other draft in the plan remains an unfiled
  draft

### Requirement: A dispatched scout's state is visible on its draft, without leaving the plan

Each dispatched scout draft SHALL show, in the planning surface, which of dispatched-and-running,
reported, or failed it currently is, updating without a manual reload, so captain does not need the
work page to see it.

#### Scenario: A running dispatched scout shows as running

- **WHEN** a scout draft has been dispatched and its ticket has not yet finished
- **THEN** the draft shows that it is dispatched and running

#### Scenario: A finished dispatched scout shows that its report has arrived

- **WHEN** a dispatched scout's ticket finishes and its report reaches the planning agent
- **THEN** the draft shows that its report has arrived, without captain reloading the page

#### Scenario: The Dispatch action is gone once a draft has been dispatched

- **WHEN** captain views a scout draft that has already been dispatched
- **THEN** no Dispatch action is shown for it, replaced by its current state
