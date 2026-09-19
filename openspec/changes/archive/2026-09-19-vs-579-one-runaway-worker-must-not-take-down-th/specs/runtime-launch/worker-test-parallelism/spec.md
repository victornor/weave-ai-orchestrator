## Purpose

Stops a worker running a project's full test suite from spawning one worker thread per CPU core and exhausting the host, by giving every worker turn environment defaults that cap the common test runners.

## ADDED Requirements

### Requirement: Workers carry test-runner parallelism caps by default

Every worker turn SHALL be spawned with environment variables that cap the parallelism of the common test runners — at minimum the isolated-vitest knob (`VITEST_MAX_WORKERS`), a jest-compatible worker cap, and a cap for `NODE_OPTIONS`-style thread use — unless the role, workspace or the runtime's own options set a competing value, in which case the explicit value SHALL win.

#### Scenario: A worker runs the full suite
- **WHEN** a worker runs a vitest suite and does not set its own worker count
- **THEN** the runner is capped by the injected default rather than using one thread per core

#### Scenario: A project sets its own worker count
- **WHEN** a project's test command sets `VITEST_MAX_WORKERS`
- **THEN** the project's own value is used and the injected default does not override it

### Requirement: The cap is documented where workers will meet it

The worker skill SHALL state that the daemon sets these defaults, name the variables, and say how a worker overrides them deliberately — so a worker does not read a cap as a malfunction.

#### Scenario: A worker needs more parallelism
- **WHEN** a worker reads its skill after a test run looks unexpectedly slow
- **THEN** the skill explains the injected cap and how to raise it deliberately for that command
