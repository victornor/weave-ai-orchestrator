# web-settings/worker-memory-limits Specification

## Purpose
Puts the worker memory limit in front of the human — the effective value, where it comes from, and the one control that sets the workspace default — so the containment is tunable without hand-editing `workspace.yaml`.

## Requirements

### Requirement: Settings shows the effective worker memory limit

The workspace settings SHALL show the effective worker memory limit and label where it came from — an explicit workspace value, or the machine-derived default — the same way model settings show their source.

#### Scenario: An unset limit
- **WHEN** the human opens workspace settings with no memory limit configured
- **THEN** the derived effective value is shown and labelled as derived

### Requirement: The workspace default is editable

The workspace settings SHALL let the human set the workspace default worker memory limit, clear it back to the derived default, and see validation refuse a value below a usable floor or above the machine's memory.

#### Scenario: Setting a limit
- **WHEN** the human enters a valid limit and saves
- **THEN** it is persisted to the workspace config and shown as the effective value with the source `workspace`

#### Scenario: Clearing a limit
- **WHEN** the human clears the field and saves
- **THEN** the value is removed and the derived default is shown again

#### Scenario: An invalid limit
- **WHEN** the human enters a value below the floor
- **THEN** the save is refused with a validation message and nothing is persisted
