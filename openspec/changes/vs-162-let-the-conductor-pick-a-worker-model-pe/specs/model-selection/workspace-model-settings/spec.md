## MODIFIED Requirements

### Requirement: A workspace holds exactly two model settings

A workspace SHALL hold exactly two settings that decide the default what an agent runs on: one for
its conductor and one for its workers. Each SHALL carry the runtime the agent is launched with, the
model it is asked to use, and optionally the reasoning effort. The model MAY be unset, meaning the
runtime chooses; the runtime SHALL always be set.

The conductor setting SHALL apply to the workspace's conductor and to nothing else. The workers
setting SHALL apply to every worker in the workspace whose ticket names no worker-option id from
the workspace catalog (or whose named option no longer exists), whatever role it was spawned from
and whatever project it works in.

A workspace MAY also hold a catalog of named worker model options, defined by
`model-selection/worker-options`. That catalog is not a third default setting: it is the list a
ticket may point at. An empty catalog SHALL leave behaviour identical to the two settings alone.

#### Scenario: Both settings are readable

- **WHEN** a workspace's model settings are read
- **THEN** the conductor setting and the workers setting are returned, each with its runtime, its
  model or the fact that the runtime chooses, and its effort where one is set, together with the
  worker-options catalog (empty when none are defined)

#### Scenario: The workers setting covers every role and project

- **WHEN** a workspace has several projects and several roles
- **THEN** all of their workers are governed by the one workers setting, unless a given ticket
  names a worker option from the workspace catalog

### Requirement: No other setting may influence a model or runtime choice

No configuration outside the two settings and the workspace's worker-options catalog SHALL
influence which runtime or model an agent runs on. A project, a role and an agent SHALL NOT carry
a runtime, a model or an effort that can be chosen by a human or by the conductor, and no request
SHALL accept one.

A ticket SHALL NOT carry a raw runtime, model or effort. A ticket MAY carry a worker-option id
that names an entry in the workspace catalog; that is the only ticket-level input that may
influence the worker's runtime or model, and it is specified in `model-selection/worker-options`.

Hiring a role SHALL NOT ask for a runtime, and approving a hire SHALL NOT offer running that role on
a different runtime. Adding a project SHALL NOT ask for a runtime.

Where an agent or a run records a runtime or a model, that record SHALL be what the turn resolved
from the settings or catalog or what the runtime itself reported, and SHALL be read-only: writing it
SHALL NOT change what any turn runs on.

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
current workspace, and SHALL NOT present a runtime or a model anywhere else as something to choose,
except the worker-options catalog in that same section. For each setting it SHALL offer the
runtimes installed on the daemon host, the models that runtime is known to offer, and a way to
name a model that is not among them. The same section SHALL let the operator add, edit and remove
worker options, each with an id, a description, a runtime, a model and optional effort.

The command line SHALL offer one command that shows both settings and the catalog, one that
changes either of the two settings, and commands that add, edit and remove worker options,
including clearing the model back to the runtime's own choice.

Changing a setting or an option SHALL take effect for the next turn that agent runs, without a
daemon restart, and SHALL NOT interrupt a turn already running.

#### Scenario: Both settings are on one page

- **WHEN** the operator opens the workspace's model settings in the web app
- **THEN** both settings are shown together, each with a runtime picker listing the installed
  runtimes and a model picker offering that runtime's known models, and the worker-options catalog
  is shown in that same section

#### Scenario: A model the runtime does not list

- **WHEN** the operator names a model that is not among the ones the runtime lists
- **THEN** it is accepted and stored as given

#### Scenario: The command line shows and sets

- **WHEN** the operator runs the command that shows the model settings
- **THEN** both settings are printed with their runtime, model and effort, the worker options are
  printed with id and description, and further commands change either setting or add, edit and
  remove options

#### Scenario: A change applies to the next turn

- **WHEN** a setting is changed while a turn is running
- **THEN** the running turn is not interrupted, and the next turn of that agent runs on the new
  setting
