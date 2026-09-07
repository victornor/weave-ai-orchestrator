# model-selection/workspace-model-settings Specification

## Purpose
TBD - created by archiving change vs-77-model-selection-is-exactly-two-per-works. Update Purpose after archive.

## Requirements

### Requirement: A workspace holds exactly two model settings

A workspace SHALL hold exactly two settings that decide what an agent runs on: one for its
conductor and one for its workers. Each SHALL carry the runtime the agent is launched with, the
model it is asked to use, and optionally the reasoning effort. The model MAY be unset, meaning the
runtime chooses; the runtime SHALL always be set.

The conductor setting SHALL apply to the workspace's conductor and to nothing else. The workers
setting SHALL apply to every worker in the workspace, whatever role it was spawned from and
whatever project it works in.

#### Scenario: Both settings are readable

- **WHEN** a workspace's model settings are read
- **THEN** exactly two are returned, one for the conductor and one for the workers, each with its
  runtime, its model or the fact that the runtime chooses, and its effort where one is set

#### Scenario: The workers setting covers every role and project

- **WHEN** a workspace has several projects and several roles
- **THEN** all of their workers are governed by the one workers setting

### Requirement: No other setting may influence a model or runtime choice

No configuration outside the two settings SHALL influence which runtime or model an agent runs on.
A project, a role and an agent SHALL NOT carry a runtime, a model or an effort that can be chosen
by a human or by the conductor, and no request SHALL accept one.

Hiring a role SHALL NOT ask for a runtime, and approving a hire SHALL NOT offer running that role on
a different runtime. Adding a project SHALL NOT ask for a runtime.

Where an agent or a run records a runtime or a model, that record SHALL be what the turn resolved
from the settings or what the runtime itself reported, and SHALL be read-only: writing it SHALL NOT
change what any turn runs on.

#### Scenario: A role carries no runtime

- **WHEN** a role is hired, read back or updated
- **THEN** it carries no runtime, no model and no effort, and a request that supplies one is
  rejected rather than silently accepted

#### Scenario: Approving a hire offers no runtime

- **WHEN** the human is asked to approve a hired role
- **THEN** the options are to approve or to decline, and none of them names a runtime

#### Scenario: A project carries no runtime

- **WHEN** a project is added or read back
- **THEN** it carries no runtime and no model, and adding one does not ask which runtime to use

#### Scenario: A recorded runtime is not an override

- **WHEN** the runtime recorded on an agent row differs from the setting that governs it
- **THEN** the agent's next turn still runs on the setting, and the record is corrected to match

### Requirement: The two settings are shown and changed from one place in each client

The web app SHALL present both settings together in one section of the settings that apply to the
current workspace, and SHALL NOT present a runtime or a model anywhere else as something to choose.
For each setting it SHALL offer the runtimes installed on the daemon host, the models that runtime
is known to offer, and a way to name a model that is not among them.

The command line SHALL offer one command that shows both settings and one that changes either of
them, including clearing the model back to the runtime's own choice.

Changing a setting SHALL take effect for the next turn that agent runs, without a daemon restart,
and SHALL NOT interrupt a turn already running.

#### Scenario: Both settings are on one page

- **WHEN** the operator opens the workspace's model settings in the web app
- **THEN** both settings are shown together, each with a runtime picker listing the installed
  runtimes and a model picker offering that runtime's known models

#### Scenario: A model the runtime does not list

- **WHEN** the operator names a model that is not among the ones the runtime lists
- **THEN** it is accepted and stored as given

#### Scenario: The command line shows and sets

- **WHEN** the operator runs the command that shows the model settings
- **THEN** both settings are printed with their runtime, model and effort, and one further command
  changes either of them

#### Scenario: A change applies to the next turn

- **WHEN** a setting is changed while a turn is running
- **THEN** the running turn is not interrupted, and the next turn of that agent runs on the new
  setting
