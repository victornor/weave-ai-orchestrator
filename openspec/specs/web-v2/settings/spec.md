# web-v2/settings Specification

## Purpose
The V2 Settings screen: one global address with two levels of tabs — a scope row (`This daemon` plus
each workspace) and a section row that changes with it — where every section reads and writes its
real setting, Models shows the daemon default and the workspace override together, read-only
descriptions are never dressed as controls, and there is no Budget tab.

## Requirements

### Requirement: Settings is one global screen with two tab levels and an applies-to line

`/v2/settings` SHALL render a single global screen with a scope row holding `This daemon` followed
by every workspace the daemon reports, and below it a section row that changes with the selected
scope. One line SHALL state what the current scope applies to: for the daemon, that it applies to
every workspace on the machine; for a workspace, that it applies to that workspace only. The daemon
scope SHALL NOT offer an "applies to" control. Selecting a different scope SHALL reset the section
to that scope's first section. The selected scope and section SHALL be addressable, so a reload or a
shared link restores both.

#### Scenario: The daemon scope

- **WHEN** the user opens `/v2/settings`
- **THEN** the scope row shows `This daemon` and every workspace, the section row shows the daemon's
  sections, and the applies-to line says it applies to every workspace on the machine

#### Scenario: Switching to a workspace scope

- **WHEN** the user selects a workspace in the scope row
- **THEN** the section row changes to that workspace's sections with its first section selected, and
  the applies-to line names that workspace as the only one it applies to

#### Scenario: The scope and section survive a reload

- **WHEN** the user is on a workspace scope's Models section and reloads
- **THEN** the same workspace scope and section are shown

#### Scenario: There is no applies-to control on the daemon

- **WHEN** the daemon scope is shown
- **THEN** the applies-to line is a statement and there is no control that changes what the daemon
  applies to

### Requirement: Every daemon section reads and writes its real setting

The daemon scope SHALL provide Updates, Models, Security & devices, Host tools, Dictation and This
device, and every one SHALL read its data from and write its changes to the existing daemon
endpoints. No listed section SHALL be a dead tab.

#### Scenario: Updates

- **WHEN** the Updates section renders
- **THEN** it shows the running version, commit and release path, the release source and target,
  a Check again control, an Upgrade control when an update is available, and the last upgrade's log
  in a scrolling block

#### Scenario: Host tools and Dictation

- **WHEN** the Host tools and Dictation sections render
- **THEN** they show the daemon's tool availability and the dictation backend respectively, and each
  writes through its existing daemon endpoint

#### Scenario: Security & devices

- **WHEN** the Security & devices section renders
- **THEN** it shows the signed-in devices with a revoke control and the password and two-factor
  controls, as the daemon reports them

### Requirement: Every workspace section reads and writes its real setting

The workspace scope SHALL provide General, Weaver, Models, Projects, Knowledge, Approvals, Channels,
Presentation and Plugins, and every one SHALL read and write the selected workspace's real settings
through the existing workspace endpoints, addressing the selected workspace rather than the route's.
No listed section SHALL be a dead tab.

#### Scenario: General edits the workspace identity

- **WHEN** the General section renders
- **THEN** it shows the workspace's name as an editable field and its ticket prefix as a read-only
  value, and saving the name writes it to the selected workspace

#### Scenario: Plugins is a read-only list

- **WHEN** the Plugins section renders
- **THEN** it lists the selected workspace's loaded plugins with their id, version, source and load
  state, and offers no control to install or remove one

#### Scenario: An unset approval default is honest

- **WHEN** an approval or delivery default has no configured value
- **THEN** its select shows the resolved built-in default, labelled as the default, rather than
  presenting the first option as an explicit choice

#### Scenario: Projects expands a row
- **WHEN** the user expands a project row in the Projects section
- **THEN** it shows the project's landing branch, setup command and max workers, and its
  delivery/setup policies, each editable and written to that project

#### Scenario: Knowledge budgets

- **WHEN** the user changes a knowledge budget in the Knowledge section
- **THEN** the selected workspace's config is patched with the new budget

#### Scenario: Channels and Presentation

- **WHEN** the Channels and Presentation sections render
- **THEN** they show the workspace's Telegram token state and pending approvals, and its presentation
  config, and each writes through its existing workspace endpoint

#### Scenario: A non-active workspace scope

- **WHEN** the user selects a workspace that is not the one the app remembers
- **THEN** the section's reads and writes address the selected workspace, not the remembered one

### Requirement: Read-only descriptions are not presented as controls

Items with no stored setting SHALL render as descriptions, not as controls with a pointer cursor or
a toggle. The Weaver section's "Reviews every approval before you see it", "Let me override a held
card" and "Model tier default for new tickets" SHALL be description rows (the tier as a static tag),
and the Knowledge section's curation schedule SHALL be a key-value description. None SHALL be a
switch, a select or a button.

#### Scenario: The Weaver descriptions

- **WHEN** the Weaver section renders
- **THEN** the three items appear as a label with an explanatory line, the tier as a static tag, and
  the section contains no switch or select

#### Scenario: The curation schedule

- **WHEN** the Knowledge section renders
- **THEN** the curation schedule reads "weekly · Sunday 03:00" and "over budget curate early" as
  text, with no control to change them

### Requirement: Models sits in one row per agent, with worker options as collapsed rows

The Models section SHALL render Weaver and Workers as two cards, each carrying a note and a single
row holding the agent's runtime, model and thinking controls, and SHALL render worker options as
collapsed rows (id, model tag, one-line summary) that expand to edit. Adding an option SHALL be a
`+ Add option` action rather than a permanently visible form. The "When to use" description SHALL be
a multiline field whose copy states that the weaver reads it and nothing else.

#### Scenario: One row per agent

- **WHEN** the Models section renders
- **THEN** the Weaver and Workers cards each show runtime, model and thinking side by side in one
  row, and each carries a note saying what the agent is

#### Scenario: A worker option expands

- **WHEN** the user expands a worker option row
- **THEN** it shows the multiline "When to use" field with its character count and the line that the
  weaver reads this and nothing else, and the runtime/model/thinking controls

#### Scenario: Adding an option

- **WHEN** the user activates `+ Add option`
- **THEN** a new collapsed option row appears for editing, rather than a permanently visible empty
  form

### Requirement: A workspace override shows its difference and resets to the daemon value

The workspace Models section SHALL mark each control — the weaver setting, the workers setting and
the worker-options catalog — as `inherited` or `overridden` from the per-control source the API
reports, not by comparing the effective value to the daemon's value. An overridden control SHALL
carry an accent border and an `overridden` tag; an inherited control SHALL use recessed styling and
an `inherited` tag.

Each control SHALL offer Override and, when overridden, Reset to daemon. Overriding an agent SHALL
write only that agent's control, so the other agent is not pinned. Overriding the worker-options
catalog SHALL materialize the daemon's catalog into the workspace so it can be edited. Reset to
daemon SHALL clear just that control — for an agent by writing `null`, for the catalog by writing
`null` — so it inherits again rather than pinning the daemon's current value.

For an overridden control a footer SHALL name the actual difference against the daemon's value (for
example "Overrides thinking high → max."); for an inherited control the footer SHALL state that the
value is inherited. A banner SHALL count what is overridden, derived from the same source map the
tags use, never from a separate comparison. The worker-option catalog SHALL be inherited or
overridden as a whole; while it is inherited it SHALL show the daemon's list, and an option's id and
description SHALL remain the daemon's meaning.

#### Scenario: An inherited agent

- **WHEN** the API reports the workspace's `weaver` control as `daemon` or `default`
- **THEN** the agent card shows the `inherited` tag, recessed controls and a footer saying it is
  inherited from the daemon

#### Scenario: An overridden agent

- **WHEN** the API reports an agent control as `workspace`
- **THEN** the card shows the `overridden` tag, an accent border, and a footer naming the differing
  fields and their values

#### Scenario: Overriding one agent does not pin the other

- **WHEN** the user changes the weaver setting while the workers setting is inherited
- **THEN** the write names only the weaver control, and the workers control still reads inherited

#### Scenario: Reset to daemon

- **WHEN** the user resets an overridden agent
- **THEN** a write clearing only that agent's control is made and the card reads as inherited again

#### Scenario: The banner count agrees

- **WHEN** the overrides banner shows a count
- **THEN** it is the number of controls the same source map marks overridden on the screen, never a
  separate literal

#### Scenario: The option list is the daemon's

- **WHEN** the worker-options catalog is inherited
- **THEN** it shows the daemon's options, and each option's id, description and meaning remain the
  daemon's

#### Scenario: The worker-options catalog inherits or overrides as a whole

- **WHEN** the API reports the workspace's `workerOptions` source as `daemon` or `default`
- **THEN** the catalog shows the daemon's options, recessed, marked inherited, and Override seeds the
  workspace's own catalog from the daemon's so its options can be changed

#### Scenario: An empty daemon catalog can still be overridden

- **WHEN** the worker-options catalog is inherited and the daemon has no options
- **THEN** Override opens the catalog editor with an empty list, nothing is written until the first
  option is added, and Cancel returns to the inherited view

#### Scenario: Resetting the catalog clears it

- **WHEN** the user resets an overridden worker-options catalog
- **THEN** a write clearing only the catalog is made and the catalog reads as inherited again,
  showing the daemon's list

### Requirement: There is no Budget tab

Neither the daemon scope nor the workspace scope SHALL offer a Budget section or link to one.

#### Scenario: No Budget section

- **WHEN** the section rows for both scopes are inspected
- **THEN** neither contains a Budget section, and no body renders spend caps

### Requirement: The device section offers a text-size control with a live preview

The device-scoped *This device* settings section SHALL offer a text-size control with a bounded set of
steps — Smallest, Smaller, Default, Large, Largest — and SHALL render a preview beside it that updates
as the choice changes. The preview SHALL be built from the app's real message rendering, showing a
user message and a weaver reply in their real bubble containers, not a placeholder or a lorem block.
Changing the choice SHALL apply the new size immediately, without leaving the settings page and
without a save step.

#### Scenario: The control and its preview

- **WHEN** the user opens the *This device* section
- **THEN** a text-size control and a preview of a user message and a weaver reply are shown together

#### Scenario: The preview follows the choice

- **WHEN** the user selects a different text-size step
- **THEN** the preview's text resizes to that step as the selection changes, alongside the rest of the
  page

#### Scenario: The preview is real message rendering

- **WHEN** the preview renders
- **THEN** it uses the same message body and bubble containers the chat uses, so it shows real
  message-shaped text and the user-versus-weaver layout rather than a lorem block

### Requirement: The text-size choice is device-local, app-wide and safe at its extremes

The text-size choice SHALL persist on the device across reloads and SHALL apply one app-wide type
scale, so the weaver chat and every other surface resize together and no surface is left at a stale
size. The Default step SHALL match today's size exactly, so an untouched install looks unchanged. At
the smallest step the reading text SHALL remain legible, and at the largest step the chat, the
composer and the decisions pane SHALL NOT overflow, clip or become unusable.

#### Scenario: The choice survives a reload

- **WHEN** the user selects a text-size step and reloads the app
- **THEN** the app starts at that step

#### Scenario: The scale applies app-wide

- **WHEN** the user changes the text size
- **THEN** the weaver chat and the rest of the app resize together, with no surface left at the old
  size

#### Scenario: The default is unchanged

- **WHEN** the preference has never been set
- **THEN** every surface renders at exactly the size it did before the preference existed

#### Scenario: The extremes hold the layout

- **WHEN** the smallest and the largest steps are rendered at desktop and phone width
- **THEN** the smallest reading text is legible and the largest does not overflow or clip the chat,
  the composer or the decisions pane
