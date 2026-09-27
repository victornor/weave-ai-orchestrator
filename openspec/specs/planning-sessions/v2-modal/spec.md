# planning-sessions/v2-modal Specification

## Purpose
Defines how captain reaches and uses the planning conversation from the V2 weaver chat: the plan tab
that holds it, the planner conversation it renders, and how the live draft list behaves as captain
and the planning agent both edit it.

## Requirements

### Requirement: The planning surface shows the conversation and the draft list together

A plan tab SHALL show the conversation with the planning agent and the current draft list at the same
time, so captain can see the effect of the conversation on the list without leaving the tab. On a
desktop-sized viewport the conversation and the draft list SHALL both be visible; on a phone-sized
viewport the draft list SHALL remain reachable from within the tab, with the conversation and the
draft list switched by a control in the tab rather than by leaving it.

#### Scenario: Both panes are visible together on desktop

- **WHEN** captain has a plan tab focused on a desktop-sized viewport with drafts in the plan
- **THEN** the conversation and the draft list are both visible without further navigation

#### Scenario: The draft list is reachable on phone

- **WHEN** captain focuses a plan tab on a phone-sized viewport
- **THEN** a control in the tab switches between the conversation and the plan's draft list, and the
  draft list is reachable without leaving the tab

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

A plan tab SHALL constrain the width of its conversation pane so that no child — the dictation meter
or any other — can widen the pane or the tab beyond the tab's own laid-out size. A child that cannot
fit SHALL be clipped or scrolled inside the pane, not allowed to grow it.

#### Scenario: Listening does not widen the pane

- **WHEN** captain starts dictation in a plan tab's composer
- **THEN** the conversation pane and the tab keep the widths they had before dictation started

#### Scenario: The pane is width-constrained

- **WHEN** the conversation pane contains a child wider than the pane
- **THEN** the child is contained by the pane rather than expanding it

### Requirement: The planning surface shows one tab per drafting plan

The weaver chat SHALL show the weaver conversation as its first tab and, after it, one tab for each
`drafting` plan in the workspace — every project's, not only the chat's selected project. Each plan
tab SHALL be tagged with its plan's project so tabs from different projects can be told apart. The
set of tabs SHALL be persisted server-side, so it survives a page reload and is the same on another
device, and the strip SHALL mark which tab is focused. When the workspace has no drafting plan the
strip SHALL show the weaver tab and the **New plan** control only.

#### Scenario: A tab per drafting plan

- **WHEN** the workspace has three drafting plans, across two projects
- **THEN** the chat shows the weaver tab plus three plan tabs, one per plan, each tagged with its
  project, with the focused one marked

#### Scenario: Tabs survive a reload

- **WHEN** captain has two drafting plans open as tabs — plus the weaver tab — and reloads the page
- **THEN** the same tabs are shown, still one per plan plus the weaver tab, with the last-focused one
  selected where the device remembers one

#### Scenario: Submitting a plan closes its tab and keeps the others

- **WHEN** captain submits one of several drafting plans
- **THEN** that plan's tab is gone, its other tabs and the weaver tab remain, and the chat focuses one
  of them

#### Scenario: A workspace with no drafting plan shows the weaver tab only

- **WHEN** the workspace has no drafting plan
- **THEN** the strip shows the weaver tab and the **New plan** control, and no plan is created until
  captain asks for one

### Requirement: Captain can start a new plan from the surface

The weaver chat's tab strip SHALL provide a **New plan** control that creates a fresh drafting plan
for the chat's selected project, with its own conversation and planner, and focuses its tab. A
project SHALL be allowed to hold several drafting plans at once.

#### Scenario: New plan adds and focuses a tab

- **WHEN** captain activates **New plan** while a drafting plan's tab is focused
- **THEN** a new drafting plan is created, a new tab appears for it, and that tab is focused with an
  empty conversation

#### Scenario: New plan leaves the other plans alone

- **WHEN** captain activates **New plan** while another drafting plan has drafts
- **THEN** the earlier plan keeps its conversation and drafts and remains available as a tab

### Requirement: Switching tabs changes the plan the surface shows

Activating a tab SHALL switch the chat's content to that tab: the weaver conversation for the weaver
tab, and the plan's conversation, draft list and planner for a plan tab. The switch SHALL NOT submit,
discard or otherwise change either plan.

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

The chat SHALL remember, on the device, which tab captain last focused in a workspace — a plan tab or
the weaver tab — and SHALL focus that tab when the chat is next opened in that workspace. When the
remembered plan is no longer a drafting plan, the chat SHALL focus another plan tab, or the weaver
tab when none remains.

#### Scenario: Reopening focuses the last-focused tab

- **WHEN** captain focuses a plan tab, leaves the chat, and opens it again for the same workspace
- **THEN** that same plan's tab is focused, or the weaver tab when that was the last-focused tab

#### Scenario: A remembered plan that is gone falls back

- **WHEN** the plan remembered for the workspace has been submitted or discarded, and the chat is
  opened for that workspace
- **THEN** the chat focuses another plan tab, or the weaver tab when none remains

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

### Requirement: The planning surface is a tab in the weaver chat

A plan's planning surface SHALL render as a tab in the V2 weaver chat beside the weaver tab, never as
a modal, overlay or full-screen sheet. Selecting a plan tab SHALL show that plan's conversation and
draft list in the chat's content area, with the weaver conversation's own tab remaining available;
selecting a tab SHALL NOT submit, discard or otherwise change any plan. On a phone-sized viewport a
plan tab SHALL use the screen's width, the same as the weaver tab, and SHALL NOT leave the plan's
draft list unreachable.

#### Scenario: The planning surface is not a modal

- **WHEN** captain starts or opens a plan
- **THEN** the plan appears as a tab in the weaver chat and no modal, overlay or full-screen sheet is
  shown

#### Scenario: Selecting a plan tab shows it in the chat

- **WHEN** captain selects a plan's tab
- **THEN** the chat's content area shows that plan's conversation and draft list, and the weaver
  tab remains available in the strip

#### Scenario: Selecting a tab does not change any plan

- **WHEN** captain switches from one plan tab to another and back
- **THEN** neither plan is submitted, discarded or otherwise changed by the visits

#### Scenario: A phone plan tab fills the width

- **WHEN** captain opens a plan tab on a phone-sized viewport
- **THEN** the tab uses the screen's width, the same as the weaver tab, with the plan's draft list
  reachable from within the tab

### Requirement: A plan tab's conversation renders exactly like the weaver chat

A plan tab's conversation SHALL render through the same message list, per-turn turn summary, live
working trace, markdown, attachment rows, stick-to-bottom follow and ticket reference strip as the
weaver chat, differing only in its actor name ("Planner") and in the weaver-only affordances it
omits — inline decision cards, the reply control and the unattributed-worker row. Its composer SHALL
carry the same attach, dictate and send controls as the weaver chat and SHALL send to the plan's
planner; it SHALL NOT offer the chat's project scope selector, being bound to the plan's own project.

#### Scenario: The plan conversation matches the weaver chat

- **WHEN** the planning agent's turn produced a message with tool calls, tokens and a context figure
- **THEN** the plan tab renders the same message list, turn-summary line and working trace the weaver
  chat would for the same turn, naming the actor "Planner"

#### Scenario: Attachments behave identically

- **WHEN** captain attaches an image or text file in a plan tab's composer and sends
- **THEN** it is uploaded with the message and rendered as an attachment row exactly as the weaver
  chat renders one

#### Scenario: The plan composer has no project selector

- **WHEN** a plan tab's composer is shown
- **THEN** it offers attach, dictate and send, and does not offer the chat's project scope selector

#### Scenario: The plan composer sends to the planner

- **WHEN** captain sends a message from a plan tab's composer
- **THEN** it is posted to that plan's planner conversation

#### Scenario: Decision cards, the reply control and the unattributed-worker row stay absent

- **WHEN** the plan tab's conversation renders a planner turn
- **THEN** it shows no inline decision card, no reply-to-this-message control and no row of
  unattributed live workers below the conversation, because the planner never raises a decision and
  never leaves a dispatch this tab cannot chip under a message

### Requirement: New plan is created in the chat's selected project

The **New plan** control SHALL create the fresh drafting plan in the project selected in the weaver
composer, defaulting to the workspace's first project when the composer is on `Auto`. Changing the
chat's project scope SHALL change where a subsequent **New plan** is created and SHALL NOT create,
discard or re-scope any existing plan.

#### Scenario: New plan uses the selected project

- **WHEN** the weaver composer is scoped to a project and captain activates **New plan**
- **THEN** the new drafting plan belongs to that project

#### Scenario: Auto defaults to the workspace's first project

- **WHEN** the weaver composer is on `Auto` and captain activates **New plan**
- **THEN** the new drafting plan belongs to the workspace's first project

#### Scenario: Changing the scope does not change existing plans

- **WHEN** captain changes the chat's project scope while plans already exist
- **THEN** no plan is created, discarded or re-scoped by the change

### Requirement: Each draft card is collapsed to a title and summary by default

Each draft card in the Plan tab's list SHALL be collapsed by default to a title and a short summary,
together with the compact facts already shown on the card — its kind, priority, target role,
dependencies, effective tier and status. Expanding the card SHALL reveal the draft's full description.
Collapsing SHALL NOT discard or alter the full description; the summary is additional to it.

#### Scenario: A freshly loaded plan shows collapsed cards

- **WHEN** captain opens a plan tab whose draft list has one or more drafts
- **THEN** every draft card is collapsed, showing its title and short summary plus its compact facts,
  and none shows the full description

#### Scenario: Expanding one card reveals its full description

- **WHEN** captain expands a collapsed draft card
- **THEN** that card shows the draft's full description while the other cards remain collapsed

#### Scenario: The full description is preserved

- **WHEN** a draft with a long description is collapsed and expanded again
- **THEN** the full description is shown unchanged

### Requirement: Draft cards can be expanded and collapsed individually and all at once

The Plan tab SHALL provide per-card expand and collapse controls and list-level **expand all** and
**collapse all** controls. A card's control SHALL be operable by keyboard and SHALL expose its
expanded or collapsed state to assistive technology. The existing per-draft edit, reorder and delete
controls SHALL remain available while the card is collapsed.

#### Scenario: Expand all and collapse all

- **WHEN** captain activates expand all on a list with several drafts, then collapse all
- **THEN** every card expands in one action, and every card collapses again in one action

#### Scenario: Editing, reorder and delete work on a collapsed card

- **WHEN** captain edits, reorders or deletes a draft while its card is collapsed
- **THEN** the action applies to that draft exactly as it does on an expanded card

### Requirement: A card's expanded state survives the plan refreshing under it

When the draft list refreshes — because the planner added or edited a draft, or captain changed one —
each card's expanded or collapsed state SHALL be preserved, keyed to the draft rather than to its
position or the fresh data. A card that was expanded SHALL stay expanded across the refresh.

#### Scenario: An expanded card stays expanded after the planner's edit

- **WHEN** captain has expanded a draft card and the drafting conversation then updates that draft
- **THEN** the card is still expanded after the refresh, showing the updated description

#### Scenario: A collapsed card does not open on its own

- **WHEN** captain has all cards collapsed and the planning agent adds a new draft
- **THEN** the existing cards stay collapsed and the new draft's card is also collapsed

### Requirement: The draft list shows how many drafts the plan has

The Plan tab's draft list SHALL show the number of drafts in the plan, so an overview is available
without counting cards on screen.

#### Scenario: The count reflects the plan

- **WHEN** captain views a plan with six drafts
- **THEN** the draft list shows that it contains six drafts

#### Scenario: The count updates with the list

- **WHEN** a draft is added to or removed from the plan
- **THEN** the displayed count changes to match the new number of drafts

### Requirement: A dispatched scout shows a live ticket chip in the planning conversation

The plan tab's conversation SHALL render the ticket reference strip under a planner message exactly
as `conductor-chat/dispatch-labels` specifies for the weaver chat — the same `V2TicketStrip` chip,
carrying the ticket's identifier and live status, opening the ticket through the chat's shared link
handler, and expanding in place to the ticket's live activity feed behind its chevron — reusing that
one component rather than a second implementation.

A chip for a scout the planner dispatched SHALL be derived from the draft's link to the ticket it
created, not solely from the planner's message text, so it renders even when the planner's reply
names no identifier. A ticket identifier the planner's reply does name SHALL render a strip the same
way a weaver message's does. The strip SHALL survive reopening the plan, deriving from the same
durable records the weaver chat's strip does.

#### Scenario: A dispatch renders a chip even when the reply omits the identifier

- **WHEN** the planner dispatches a scout draft and replies without naming the created ticket
- **THEN** a chip for that ticket still renders under the reply, showing its identifier and live
  status

#### Scenario: A planner message naming a ticket gets a strip

- **WHEN** a planner message's text names a ticket identifier that resolves to a real ticket
- **THEN** a strip renders under that message the same way it would under a weaver message naming
  the same identifier

#### Scenario: The chip opens the ticket and expands to the live feed

- **WHEN** captain activates a chip's body, or its chevron, in the plan tab's conversation
- **THEN** activating the body opens the ticket through the chat's shared link handler, and
  activating the chevron expands an inline panel showing the ticket's live activity feed, exactly as
  in the weaver chat

#### Scenario: The chip survives reopening the plan

- **WHEN** captain closes the plan tab and reopens it after a scout has been dispatched
- **THEN** the same chip renders in the same position, showing the ticket's current status
