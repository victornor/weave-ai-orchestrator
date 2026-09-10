# agent-prompts/conditional-repo-files Specification

## Purpose
The daemon-rendered worker brief and worker `AGENTS.md` only tell a
worker to read a project-repo file (`work/AGENTS.md`,
`work/openspec/config.yaml`) when that worker's own worktree actually
contains it, so a worker in a project without one is never sent to read
a file that does not exist.

## Requirements

### Requirement: Worker brief names `work/AGENTS.md` only when it exists in the worktree

When the daemon renders a worker's brief (`renderBrief`) or worker
`AGENTS.md` (`renderWorkerInstructions`), it SHALL check whether the
worker's own worktree contains an `AGENTS.md` file at its root. The
rendered brief and worker `AGENTS.md` SHALL instruct the worker to read
`work/AGENTS.md` only when that file exists. When it does not exist, the
rendered output SHALL state plainly that the project has no
`work/AGENTS.md` of its own, and SHALL NOT instruct the worker to read
one.

#### Scenario: Project ships its own AGENTS.md

- **WHEN** the daemon renders a worker's brief and worker `AGENTS.md` for a worktree that contains `AGENTS.md` at its root
- **THEN** the rendered brief instructs the worker to read `work/AGENTS.md` once
- **AND** the rendered worker `AGENTS.md` also instructs the worker to read `work/AGENTS.md` once

#### Scenario: Project has no AGENTS.md of its own

- **WHEN** the daemon renders a worker's brief and worker `AGENTS.md` for a worktree that has no `AGENTS.md` at its root
- **THEN** the rendered brief does not instruct the worker to read `work/AGENTS.md`
- **AND** the rendered brief states the project has no `work/AGENTS.md` of its own
- **AND** the rendered worker `AGENTS.md` does not instruct the worker to read `work/AGENTS.md` either

### Requirement: Worker brief names `work/openspec/config.yaml` only when it exists in the worktree

When the daemon renders a worker's brief or worker `AGENTS.md`, it SHALL
check whether the worker's own worktree contains `openspec/config.yaml`.
The rendered output SHALL name `work/openspec/config.yaml` as a context
pointer only when that file exists.

#### Scenario: Project has an OpenSpec config

- **WHEN** the daemon renders a worker's brief for a worktree that contains `openspec/config.yaml`
- **THEN** the rendered brief's context pointers list `work/openspec/config.yaml`

#### Scenario: Project has no OpenSpec config

- **WHEN** the daemon renders a worker's brief for a worktree that has no `openspec/config.yaml`
- **THEN** the rendered brief's context pointers do not list `work/openspec/config.yaml`
