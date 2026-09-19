## MODIFIED Requirements

### Requirement: Worker brief names `work/openspec/config.yaml` only when it exists in the worktree

When the daemon renders a worker's brief or worker `AGENTS.md`, it SHALL
check whether the worker's own worktree contains `openspec/config.yaml`
AND whether the ticket's project has its OpenSpec mode on. The rendered
output SHALL name `work/openspec/config.yaml` as a context pointer only
when both hold. When the project's mode is off, the rendered output SHALL
NOT name `work/openspec/config.yaml` even if the worktree still contains
the file.

#### Scenario: Project has an OpenSpec config

- **WHEN** the daemon renders a worker's brief for a worktree that contains `openspec/config.yaml` on a project whose OpenSpec mode is on
- **THEN** the rendered brief's context pointers list `work/openspec/config.yaml`

#### Scenario: Project has no OpenSpec config

- **WHEN** the daemon renders a worker's brief for a worktree that has no `openspec/config.yaml`
- **THEN** the rendered brief's context pointers do not list `work/openspec/config.yaml`

#### Scenario: Project's mode is off but the file still exists

- **WHEN** the daemon renders a worker's brief for a worktree that contains `openspec/config.yaml` on a project whose OpenSpec mode is off
- **THEN** the rendered brief's context pointers do not list `work/openspec/config.yaml`
