# planning-sessions/v2-modal — delta

## MODIFIED Requirements

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

## ADDED Requirements

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
