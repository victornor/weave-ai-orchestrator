## MODIFIED Requirements

### Requirement: The daemon holds three independent optional model overlays

The daemon SHALL be able to hold an overlay for each of: the conductor setting, the workers
default setting, and the named worker-options catalog. Each overlay SHALL be independent of
the others. A conductor or workers overlay SHALL be a full setting (runtime, model or the
fact that the runtime chooses, optional effort), not a model id alone. A catalog overlay
SHALL be a list of named options, each with id, description, runtime (nullable: unset means
not yet chosen), model and optional effort, using the same shape and limits as the workspace
catalog.

An overlay SHALL be empty until it is filled. Empty SHALL mean: the conductor or
workers overlay is absent or null; the catalog overlay is absent, null, or an empty list.
The one exception is a daemon config directory that has no `daemon.yaml` yet: starting the
daemon SHALL write that file with the catalog overlay already filled, as specified in
`model-selection/fresh-install-defaults`. A `daemon.yaml` that already exists is not that
exception.

#### Scenario: All overlays empty is valid

- **WHEN** the daemon's model overlays are read and none have been filled
- **THEN** each overlay is returned empty, and every workspace still uses its own model
  settings

#### Scenario: Overlays can be filled independently

- **WHEN** only the daemon conductor overlay is filled
- **THEN** the workers overlay and the catalog overlay remain empty

#### Scenario: A filled overlay is a full setting

- **WHEN** the operator fills the daemon conductor overlay
- **THEN** it stores a runtime, a model or the fact that the runtime chooses, and an effort
  where one is set
