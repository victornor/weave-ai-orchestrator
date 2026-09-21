# worker-provisioning/worktree-provisioning Specification

## Purpose
A worker that needs a checkout always has one before its turn runs — created at spawn, recreated by a
relaunch or repair, or resumed on boot after a restart interrupted provisioning — so a missing
worktree can never be mistaken for a ready worker.

## Requirements

### Requirement: A worker that needs a checkout is provisioned before its turn runs

Before a turn starts for a worker that needs a checkout, the daemon SHALL have a worktree for that
worker on disk. When the worker's recorded worktree path is null or the directory it names is absent,
the run's prepare step SHALL create the worktree (the same way a spawn does) and the turn SHALL run in
it. When the worktree cannot be created, the run SHALL fail with a clear, retryable error naming the
failure, and SHALL NOT run a turn without a checkout.

A worker that does not need a checkout — a knowledge-curation worker with no worktree of its own, or a
ticketless persistent session — SHALL be unaffected.

#### Scenario: A worker relaunched active with a null path gets a worktree on its next run

- **WHEN** a worker needing a checkout has `worktreePath` null and a turn is dispatched for it
- **THEN** the prepare step creates its worktree and the turn runs with the worktree path in its environment

#### Scenario: A recorded worktree whose directory is gone is recreated

- **WHEN** a worker's `worktreePath` is set but the directory does not exist and a turn is dispatched
- **THEN** the prepare step creates the worktree before the turn starts

#### Scenario: A worktree that cannot be created fails the run retryably

- **WHEN** provisioning a worker's missing worktree fails on the prepare step
- **THEN** the run fails with a clear error from the retryable transient family, no turn is spawned, and the worker is not left holding a checkoutless turn

#### Scenario: A curation worker with no worktree is unaffected

- **WHEN** a turn runs for a knowledge-curation worker that was spawned without a worktree
- **THEN** the prepare step does not attempt to create one and the turn proceeds as before

### Requirement: A relaunch or repair provisions the checkout before marking a worker active

A relaunch — including the retry and liveness-repair paths that call it — of a worker that needs a
checkout and has a null or missing worktree SHALL create the worktree before it marks the worker
`active` or queues its next turn. If provisioning fails, the relaunch SHALL fail with the cause and
SHALL NOT mark the worker `active` with a null path.

#### Scenario: Relaunching a worker whose worktree is missing provisions it

- **WHEN** a relaunch is requested for a worker needing a checkout whose `worktreePath` is null or whose directory is absent
- **THEN** the worktree is created, the worker becomes `active` with a non-null path, and its next turn is queued

#### Scenario: A failed provisioning does not leave the worker active with a null path

- **WHEN** a relaunch is requested for such a worker and creating the worktree fails
- **THEN** the relaunch fails and the worker is not reported as active with a null worktree path

### Requirement: A restart resumes interrupted worktree provisioning on boot

When the daemon starts, it SHALL find workers that need a checkout whose worktree path is null or
whose directory is absent and provision them, so a worker whose creation was cut off by a drain,
restart or crash finishes provisioning without human action. A worker whose worktree exists SHALL be
left untouched.

This boot-time sweep is the chosen mechanism — rather than starting creation only after a restart
completes — because the worker row and the ticket's worker binding already exist by the time the
daemon dies, so nothing else would ever resume them.

#### Scenario: A worker created during a restart is provisioned on boot

- **WHEN** the daemon starts and a worker needing a checkout exists with a null worktree path
- **THEN** the sweep creates its worktree and the worker can run its first turn

#### Scenario: A healthy worker is left untouched

- **WHEN** the daemon starts and a worker's worktree path is set and its directory exists
- **THEN** the sweep does not create, remove or alter that worktree

### Requirement: A repair that provisions a checkout is visible

When the daemon provisions a missing worktree outside a normal spawn — on a turn's prepare step, a
relaunch, or the boot sweep — it SHALL log the repair and record an activity entry naming the worker
and the ticket, so a worker is never silently left active with a null path.

#### Scenario: The repair is recorded against the worker

- **WHEN** a missing worktree is provisioned outside spawn
- **THEN** an activity entry naming the worker and its ticket is recorded and the repair is logged
