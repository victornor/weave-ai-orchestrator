## Purpose

A named worker option can exist before anyone has chosen a runtime or a model for it, and that unfinished state is distinct from every configured choice so the option cannot silently run.

## ADDED Requirements

### Requirement: An unset runtime means the option is not yet chosen

A worker option's `runtime` MAY be unset (`null`). Unset SHALL mean the operator has not chosen an adapter for that option. It SHALL be distinct from a named runtime whose `model` is unset, which still means the runtime picks the model. An option with an unset runtime SHALL also have an unset model and no effort.

Parsing or storing an option SHALL NOT fill a runtime the operator did not pick. In particular it SHALL NOT default an omitted or null runtime to `claude` or to any other adapter.

The conductor setting and the workers default setting are not this: each of those SHALL still require a runtime.

#### Scenario: Null runtime is stored as unset

- **WHEN** a worker option is written with `runtime` null and `model` null
- **THEN** it is stored with no runtime and no model, and a later read returns that same unset pair

#### Scenario: Omitted runtime does not become claude

- **WHEN** a worker option is parsed with no runtime field
- **THEN** it is unset, not stored as `claude`

#### Scenario: A named runtime with null model is still configured

- **WHEN** a worker option is written with runtime `codex` and model null
- **THEN** it is a configured option whose runtime picks the model, not an unconfigured option

### Requirement: An unconfigured option cannot be used to run a worker

A ticket SHALL NOT be created or assigned with a worker-option id whose matching option in the effective catalog has no runtime. The write SHALL be rejected with the error code `model_unconfigured`, and the message SHALL name the option id and that no runtime is chosen.

Spawning a worker or launching a turn for a ticket that names such an option SHALL fail with the same code and reason, and SHALL NOT launch any runtime, including `claude`.

An option that is missing from the catalog SHALL still fall back to the workers setting, as today. Unconfigured is not missing: the option exists and is unusable.

#### Scenario: Create with an unconfigured option is rejected

- **WHEN** a ticket is created with a worker-option id whose catalog entry has no runtime
- **THEN** the write is rejected with `model_unconfigured` naming that id, and no ticket is stored with that id

#### Scenario: Assign with an unconfigured option is rejected

- **WHEN** a ticket that has no worker is assigned with a worker-option id whose catalog entry has no runtime
- **THEN** the assign is rejected with `model_unconfigured` naming that id, and the stored id is left unchanged

#### Scenario: A turn naming an unconfigured option does not launch

- **WHEN** a worker's turn would launch and its ticket names a catalog option that has no runtime
- **THEN** the turn fails with `model_unconfigured` naming that option, and no runtime process is started

#### Scenario: A missing option still falls back

- **WHEN** a worker's turn is launched and its ticket names an option id that is not in the effective catalog
- **THEN** it is launched on the workers setting, as today
