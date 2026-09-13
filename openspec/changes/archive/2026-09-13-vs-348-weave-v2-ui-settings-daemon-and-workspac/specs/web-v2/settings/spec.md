## Purpose

The V2 Settings screen: one global address with two levels of tabs — a scope row (`This daemon` plus
each workspace) and a section row that changes with it — where every section reads and writes its
real setting, Models shows the daemon default and the workspace override together, read-only
descriptions are never dressed as controls, and there is no Budget tab.

## ADDED Requirements

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

The workspace Models section SHALL mark each agent and each worker option as `inherited` or
`overridden` by comparing the workspace's effective value to the daemon's value for that control. An
overridden control SHALL carry an accent border and an `overridden` tag; an inherited control SHALL
use recessed styling and an `inherited` tag. Each SHALL offer Override and, when overridden, Reset
to daemon; Reset SHALL write the daemon's value for that control. A footer SHALL name the actual
difference (for example "Overrides thinking high → max.") or state that the value is inherited. A
banner SHALL count what is overridden, derived from the same comparison as the tags and footers. The
worker-option list SHALL remain the daemon's list — a workspace changes which model an option runs
on, not what the option means.

#### Scenario: An inherited agent

- **WHEN** a workspace's effective agent value equals the daemon's value
- **THEN** the agent card shows the `inherited` tag, recessed controls and a footer saying it is
  inherited from the daemon

#### Scenario: An overridden agent

- **WHEN** a workspace's effective agent value differs from the daemon's value
- **THEN** the card shows the `overridden` tag, an accent border, and a footer naming the differing
  fields and their values

#### Scenario: Reset to daemon

- **WHEN** the user resets an overridden agent
- **THEN** the daemon's value for that agent is written to the workspace and the card reads as
  inherited again

#### Scenario: The banner count agrees

- **WHEN** the overrides banner shows a count
- **THEN** it is the number of controls the same comparison marks overridden on the screen, never a
  separate literal

#### Scenario: The option list is the daemon's

- **WHEN** a workspace overrides a worker option's model
- **THEN** it can change only that option's runtime, model and thinking, and the option's id and
  description remain the daemon's

### Requirement: There is no Budget tab

Neither the daemon scope nor the workspace scope SHALL offer a Budget section or link to one.

#### Scenario: No Budget section

- **WHEN** the section rows for both scopes are inspected
- **THEN** neither contains a Budget section, and no body renders spend caps
