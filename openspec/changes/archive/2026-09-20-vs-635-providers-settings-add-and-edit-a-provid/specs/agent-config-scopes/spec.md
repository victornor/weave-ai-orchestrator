## ADDED Requirements

### Requirement: A provider's models are editable at both scopes
Provider administration SHALL let an operator list, add, edit and remove the entries of a provider profile's `models` at both the daemon scope and a workspace override. Each entry SHALL have a required id, unique within the profile, and the fields the provider model schema declares, rendered from that schema rather than as independent per-field controls. Saving SHALL write the entries into `profile.models` through the existing put route, with no other field of the profile rebuilt from a subset.

#### Scenario: Editing models on a daemon provider
- **WHEN** an operator adds a model id and its context window on a daemon-scope provider and saves
- **THEN** the daemon provider's `profile.models` carries that entry and a later run can select `<provider>/<id>`

#### Scenario: Editing models on a workspace override
- **WHEN** an operator overrides an inherited provider in a workspace, edits its models and saves
- **THEN** the workspace's own entry carries those models and the daemon's entry is unchanged

#### Scenario: Removing a model
- **WHEN** an operator removes a model entry and saves
- **THEN** the saved profile no longer lists it

#### Scenario: An empty models list is valid
- **WHEN** a provider with no models is opened
- **THEN** the editor shows an empty state and saving it keeps the provider with no models

### Requirement: Model discovery is available at both scopes
The models editor SHALL offer a fetch-from-endpoint action that requests the provider's model list through the discovery route and shows the returned ids to pick from, at both the daemon scope and a workspace override. Adding a picked id SHALL append it to the models list being edited. A failed discovery SHALL show its one-line reason and leave manual entry available. The action SHALL work against the profile being edited before it is saved, and with a key typed but not yet saved.

#### Scenario: Picking a discovered model
- **WHEN** discovery returns ids and the operator picks one
- **THEN** that id is added to the models list and is written on the next save

#### Scenario: Discovery fails
- **WHEN** the endpoint has no models list
- **THEN** the editor shows the one-line reason and the manual add control still works

#### Scenario: Before saving
- **WHEN** the operator has changed the base URL in the editor but not saved and triggers discovery
- **THEN** discovery uses the edited base URL
