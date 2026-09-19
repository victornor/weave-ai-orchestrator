# runtime-launch/worker-memory-limits Specification

## Purpose
Defines where a worker's memory limit comes from — a machine-aware default, a workspace setting, and a per-role override — and how the effective value is resolved, propagated and reported.

## Requirements

### Requirement: A default derived from the machine and the run concurrency

With nothing configured, a worker's memory limit SHALL be derived from the daemon host's total memory, as a fraction of it divided by the workspace's run concurrency (`defaults.maxConcurrentRuns`), so the sum of the workers that may run at once cannot exceed that fraction of the machine. The derivation SHALL apply a floor so a small host still gives a worker a usable limit.

The configured value SHALL win over the derived one; an absent or unset value SHALL mean "derive", never "no limit" and never zero.

#### Scenario: A default install on a large host
- **WHEN** no memory limit is configured and several workers may run at once
- **THEN** each worker's limit is the machine-derived value and their sum is a fraction of total memory

#### Scenario: A configured value
- **WHEN** the workspace sets a memory limit
- **THEN** every worker uses the configured value in place of the derived one

### Requirement: Overridable per workspace and per role

The workspace SHALL hold a default worker memory limit, and a role SHALL be able to override it. A role with no override SHALL inherit the workspace value; a workspace with no value SHALL fall back to the derived default.

The precedence SHALL be: role override, then workspace default, then derived default.

#### Scenario: A role that overrides the workspace
- **WHEN** a role sets its own limit and its project runs on a workspace that sets another
- **THEN** that role's workers use the role's limit and other roles use the workspace's

#### Scenario: A role that inherits
- **WHEN** a role sets no limit
- **THEN** its workers use the workspace default, or the derived value when the workspace sets none

### Requirement: The effective value and its source are readable

Every surface that can ask what a worker will use SHALL be able to read the effective limit for a workspace and role and where it came from (role, workspace, or derived), so a displayed number is never mistaken for one that was explicitly set.

#### Scenario: Reading an inherited limit
- **WHEN** a role inherits its limit from the workspace
- **THEN** the effective value and the source `workspace` are both reported

### Requirement: Changing a limit does not disturb a running turn

A limit change SHALL apply to worker turns spawned after it takes effect. It SHALL NOT retroactively kill or resize a worker already running.

#### Scenario: Lowering the limit while a worker runs
- **WHEN** an operator lowers the workspace limit while a worker turn is running
- **THEN** that turn continues under the limit it started with, and the next spawned turn uses the new one
