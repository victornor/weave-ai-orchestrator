# plugins/lifecycle Specification

## Purpose
Covers how a plugin gets enabled across one or every workspace, how its failures are contained, how
its hooks are scoped, and how a human sees what loaded — the load-bearing plumbing the other plugin
capabilities depend on.

## Requirements

### Requirement: A daemon-wide plugin loads for every workspace

A plugin listed under `plugins:` in `daemon.yaml` SHALL be loaded for every workspace the daemon
serves, in addition to any plugin listed in that workspace's own `workspace.yaml`.

#### Scenario: A daemon-wide plugin reaches every workspace

- **WHEN** `daemon.yaml` lists a plugin under `plugins:`
- **THEN** every workspace the daemon serves loads it, without that plugin appearing in any
  individual `workspace.yaml`

#### Scenario: A workspace still loads its own plugins too

- **WHEN** a workspace lists a plugin in its own `workspace.yaml` `plugins:` that the daemon-wide
  list does not
- **THEN** that workspace loads both the daemon-wide and its own plugin

### Requirement: A failing plugin never stops the daemon or another plugin

A plugin that throws while loading, while registering, in a tool call, in a route handler, or while
rendering its page SHALL be logged and contained to that one plugin (or that one call); it SHALL NOT
prevent the daemon from starting, another plugin from loading, or another plugin's tool, route, or
page from working.

#### Scenario: One plugin's load failure does not block another's

- **WHEN** plugin `a`'s `register()` throws during workspace load
- **THEN** the workspace still finishes loading
- **AND** plugin `b`, listed after `a`, still loads and its tools/routes/page work

#### Scenario: An unsupported apiVersion is skipped, not fatal

- **WHEN** a plugin declares an `apiVersion` this daemon does not support
- **THEN** that plugin is not loaded and the failure is logged
- **AND** every other configured plugin still loads

### Requirement: A plugin's agent tools and hooks are scoped to the workspaces that load it

A tool or hook a plugin registers while loading for one workspace SHALL be available only in that
workspace (and any other workspace that also loads that same plugin), never in a workspace that does
not load it — including a workspace loaded before or after the one that registered it.

#### Scenario: A hook registered for one workspace fires for that workspace

- **WHEN** a plugin loaded for workspace `acme` registers a hook for `ticket.status`
- **AND** a ticket in `acme` changes status
- **THEN** the hook's handler runs

#### Scenario: A hook registered for one workspace does not fire for another

- **WHEN** the same plugin is not loaded for workspace `beta`
- **AND** a ticket in `beta` changes status
- **THEN** that hook's handler does not run

#### Scenario: Load order does not affect hook or tool scoping

- **WHEN** workspace `acme` is loaded before workspace `beta`, and only `acme` loads a plugin
- **THEN** that plugin's tools and hooks are available in `acme`
- **AND** are not available in `beta`, regardless of which workspace loaded first

### Requirement: Loaded plugins are visible for management

A workspace's own view of its loaded plugins SHALL list each plugin's id, version, source
(workspace-configured or daemon-wide), whether it loaded successfully, and its load error when it
did not.

#### Scenario: A failed plugin still appears, with its error

- **WHEN** a plugin fails to load for a workspace
- **THEN** that workspace's plugin list includes an entry for it marked as not loaded, with the
  error that caused the failure

#### Scenario: A daemon-wide plugin is labeled by source

- **WHEN** a plugin reaches a workspace via `daemon.yaml`'s `plugins:` list
- **THEN** that workspace's plugin list marks its source as daemon-wide, not workspace-configured
