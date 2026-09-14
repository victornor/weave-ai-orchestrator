## REMOVED Requirements

### Requirement: YOLO mode is a workspace setting a project can override
**Reason**: A workspace-wide default that every project without an override inherits turns automatic
approvals on for every project, including ones added later, so granting autonomy is accidental
rather than a deliberate choice about one repository.
**Migration**: The one-time migration below copies a workspace's `defaults.yolo: true` onto each
existing project's `policies.yolo` that has not set it. YOLO is set per project thereafter through
`weave project set-policy <id> yolo=on|off` or the Settings → Projects toggle.

## ADDED Requirements

### Requirement: YOLO mode is a per-project setting

YOLO mode SHALL be set on a project and SHALL be off for a project that has not set it. There SHALL
be no workspace-wide YOLO setting, and no project SHALL inherit the mode from the workspace. A
project added after this change SHALL start with the mode off.

Whether the mode is on for a given ticket SHALL be determined solely by that ticket's project. A
ticket with no project SHALL be treated as having the mode off.

The setting SHALL be readable and writable from the web app and from the CLI, and the value the
daemon acts on SHALL be the value those surfaces show.

#### Scenario: Off for a project that has not set it

- **WHEN** neither a project nor anything above it sets the mode
- **THEN** the mode is off for that project and every approval is put to the human exactly as it is without this feature

#### Scenario: A new project starts off

- **WHEN** a project is added while other projects have the mode on
- **THEN** the new project has the mode off

#### Scenario: A ticket with no project

- **WHEN** a ticket has no project
- **THEN** the mode is off for it, whatever any project's setting is

#### Scenario: Changed from either surface

- **WHEN** the human turns the mode on or off for a project from the web app or from the CLI
- **THEN** that project's setting changes and both surfaces then report the new value

### Requirement: A workspace's former default is migrated to its projects once

When a workspace is loaded and its stored config still carries `defaults.yolo: true`, the daemon
SHALL copy that value onto every existing project that has not set `policies.yolo` itself, SHALL
leave a project that explicitly set `policies.yolo: false` unchanged, and SHALL record in the log
how many projects it changed. The migration SHALL run once per workspace; on the next load it SHALL
do nothing. After it has run, `defaults.yolo` SHALL grant nothing, and a project added later SHALL
not receive it.

The workspace's stored `defaults.yolo` SHALL be dropped when the migration writes the config back.
Writing the key again SHALL be refused with an error naming the per-project setting as its
replacement. Reading a workspace that still carries the key SHALL never fail.

#### Scenario: A workspace with the old default on

- **WHEN** a workspace whose config has `defaults.yolo: true` and two projects with no `policies.yolo` is loaded for the first time after this change
- **THEN** both projects are stored with `policies.yolo: true`, the change is logged, and both remain in YOLO mode exactly as before

#### Scenario: An explicit project opt-out is preserved

- **WHEN** that workspace also has a project whose `policies.yolo` is explicitly `false`
- **THEN** the migration leaves that project off

#### Scenario: The migration runs once

- **WHEN** the same workspace is loaded again
- **THEN** the migration does nothing and the projects keep the values it wrote

#### Scenario: A newly added project is not affected

- **WHEN** a project is added after the migration has run
- **THEN** it starts with the mode off even though the old workspace default was on

#### Scenario: Writing the deprecated workspace key is refused

- **WHEN** `defaults.yolo` is written through the CLI or the config API
- **THEN** the write is refused with an error naming the per-project setting as its replacement, and no other workspace setting is changed

## MODIFIED Requirements

### Requirement: An auto-approval is recorded as the daemon's, naming the mode

An approval granted under this mode SHALL be recorded against the same decision the human would have
answered, as answered by the system rather than by a human, and its recorded answer SHALL name YOLO
mode and the project whose setting granted it as the reason it was granted.

Everything that follows an answer SHALL follow an auto-approval too: the decision is no longer open,
the agent that asked is woken with the answer, and the history shows the decision and its answer
where an approval given by the human would appear.

#### Scenario: The record of a granted plan approval

- **WHEN** a plan approval has been granted under this mode
- **THEN** the decision reads as answered by the system, with an answer that names YOLO mode, and it is no longer waiting

#### Scenario: The record of a granted merge approval

- **WHEN** a merge approval has been granted under this mode
- **THEN** the decision reads as answered by the system, with an answer that names YOLO mode, and it is no longer waiting

#### Scenario: The asker is told

- **WHEN** an approval raised by a worker is granted under this mode
- **THEN** that worker is woken with the answer exactly as it is when the human answers

### Requirement: The mode is unmistakable wherever an approval would have been

Because the mode is set per project, no workspace-wide indicator SHALL claim it is on for the whole
workspace. Each project with the mode on SHALL show a visible marker where the project is shown:
in its row in Settings → Projects and in the project's overview header.

A decision that the daemon will grant SHALL NOT be presented to the human as something to approve:
wherever an approve action would otherwise be offered for it, the surface SHALL instead say the
decision is auto-approved under this mode, and SHALL offer no approve action for it. A ticket whose
only open decision is one the daemon will grant SHALL NOT be presented as waiting on the human.

Decisions the mode does not cover SHALL be presented exactly as they are without it.

#### Scenario: The indicator

- **WHEN** a project has the mode on
- **THEN** its row in Settings → Projects and its overview header each show a marker saying so, and no workspace-wide indicator claims the mode is on for every project

#### Scenario: A merge approval that will be granted

- **WHEN** an open merge approval that the daemon will grant is shown to the human
- **THEN** the card says it is auto-approved under this mode and offers no approve action

#### Scenario: A ticket waiting only on an auto-approval

- **WHEN** a ticket's only open decision is one the daemon will grant
- **THEN** the board marks it as auto-approving rather than as waiting on the human

#### Scenario: A decision the mode does not cover

- **WHEN** a hire approval or a question is shown to the human while the mode is on for the project
- **THEN** it is presented with its usual actions, unchanged
