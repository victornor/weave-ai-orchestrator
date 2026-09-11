# model-selection/fresh-install-defaults Specification

## Purpose
A daemon that has never been given a config file yet arrives with the three named worker tiers already in its catalog overlay, unconfigured, so a new deployment has something to set up rather than an empty list.

## Requirements

### Requirement: A missing daemon config file is seeded with the three worker tiers

When the daemon starts and no `daemon.yaml` exists in its config directory, it SHALL write one whose catalog overlay is exactly three options, in this order, with these ids and descriptions verbatim, each with no runtime and no model:

- `quick` — "Fastest. The fix is already located and specified — a known one-liner, rename, or config value. No diagnosis, no design choice, nothing production-facing."
- `standard` — "Default for specified work: cause known, approach clear, but spans several files or needs judgement on tests and edge cases. Not for finding out why something broke."
- `deep` — "Cause unknown, a design decision is open, or it touches production or shared infrastructure. All scouts. \"Find out why\" belongs here however small the fix looks."

That catalog overlay SHALL count as filled: every workspace on that daemon uses it, and workspace catalogs are locked, as any other filled catalog overlay is.

The conductor overlay and the workers overlay SHALL remain empty on that first write.

This behaviour SHALL be proven against a config directory that starts with no `daemon.yaml`, not against a daemon that already has one.

#### Scenario: First start writes the three unconfigured tiers

- **WHEN** the daemon starts in a config directory that has no `daemon.yaml`
- **THEN** that file is written with `quick`, `standard` and `deep` in the catalog overlay, each with those descriptions verbatim and with no runtime and no model
- **AND** the conductor overlay and the workers overlay are empty

#### Scenario: The seeded catalog is the effective catalog

- **WHEN** a workspace on that freshly started daemon reads its model settings
- **THEN** the effective worker-options catalog is those three seeded options, and the workspace catalog control is locked

### Requirement: An existing daemon config file is not rewritten to add the tiers

When `daemon.yaml` already exists, starting the daemon SHALL NOT add, replace, or clear its catalog overlay. A file that names no `models` key SHALL keep an empty overlay. A file that already has options SHALL keep those options, including their runtimes and models.

This is a starting point for a new file, not a migration of an existing one.

#### Scenario: A daemon.yaml without models stays empty

- **WHEN** the daemon starts in a config directory whose `daemon.yaml` exists and does not name a catalog overlay
- **THEN** the catalog overlay remains empty and the three tiers are not written

#### Scenario: A daemon.yaml with options is unchanged

- **WHEN** the daemon starts in a config directory whose `daemon.yaml` already lists worker options
- **THEN** those options are the overlay after start, with the same ids, descriptions, runtimes and models
