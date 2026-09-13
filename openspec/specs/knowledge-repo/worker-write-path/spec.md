# knowledge-repo/worker-write-path Specification

## Purpose
Defines how a worker's knowledge writes reach an opted-in project's own repository during a ticket: riding that ticket's branch and reviewed with its other changes, exactly like any other file the worker touches.

## Requirements

### Requirement: A worker's project knowledge write also lands in its worktree

When a worker holding a worktree writes to its own project's knowledge — a hub note, a linked document, or (for a curation ticket) a full replace — and that project has opted in to a knowledge repository, the same content SHALL also be written into the worker's worktree, at the path this project's knowledge occupies under `.weave/knowledge/`, mirroring the shape it has in the workspace's own knowledge store (the hub file, `docs/<slug>.md`, `docs/<folder>/<slug>.md`).

#### Scenario: A worker appends a hub note in an opted-in project

- **WHEN** a worker with a worktree appends a knowledge note to its own project's hub file, and that project has opted in
- **THEN** the worktree gains the same change to that project's hub file under `.weave/knowledge/`, alongside the worker's ordinary write to the workspace's knowledge store

#### Scenario: A worker writes a linked document in an opted-in project

- **WHEN** a worker creates or updates a linked knowledge document in its own project, and that project has opted in
- **THEN** the worktree gains the same document file at its corresponding path under `.weave/knowledge/docs/`

#### Scenario: A curation worker rewrites the hub in an opted-in project

- **WHEN** a curation worker replaces its project's hub file, and that project has opted in
- **THEN** the worktree gains the rewritten hub file under `.weave/knowledge/`

### Requirement: The mirrored write commits and reviews like any other file

Once written into the worktree, the knowledge file SHALL be committed with the ticket's other changes, and any conflict with another ticket's concurrent change to the same file SHALL surface and be resolved exactly as a conflict on any other file in the repository — no separate mechanism is introduced for it.

#### Scenario: The knowledge file appears in the ticket's diff

- **WHEN** a worker's ticket in an opted-in project commits its work
- **THEN** the changed knowledge file under `.weave/knowledge/` is part of that commit and visible in the ticket's pull request

### Requirement: The workspace's own knowledge store is unaffected by the mirror

Writing into the worktree SHALL NOT change how the workspace's own knowledge store is written, read, indexed, budgeted or curated — the mirror is an addition, not a replacement, and every existing knowledge behavior continues to read the workspace copy exactly as before the ticket merges.

#### Scenario: Reading knowledge mid-ticket

- **WHEN** another agent reads the same project's knowledge while the worker's ticket, carrying an uncommitted or unmerged knowledge change, is still in progress
- **THEN** it sees the workspace's own knowledge store, updated the moment the worker's write returned — the same latency as before this capability existed

### Requirement: A mirrored hub or document note never carries another ticket's unmerged content

When a worker appends a knowledge note and the write is mirrored into its worktree, the mirrored file SHALL contain only that worker's own worktree's prior content plus this call's own entry — never another, concurrently in-flight ticket's or weaver pull request's note on the same hub or document, even though that other note may already be present in the workspace's own knowledge store at the moment of this call.

#### Scenario: Two tickets note the same hub concurrently

- **WHEN** two workers, each on its own ticket for the same opted-in project, each append a knowledge note to the project hub before either ticket lands
- **THEN** each worker's worktree file contains its own note but not the other worker's

### Requirement: A worker without a worktree, or an opted-out project, never mirrors

The mirrored write SHALL only happen when the acting worker holds a worktree and the target project has opted in. Any other case (no worktree, an opted-out project, another project's knowledge) writes to the workspace's own knowledge store only.

#### Scenario: A worker in an opted-out project

- **WHEN** a worker writes its own project's knowledge, and that project has not opted in
- **THEN** nothing is written into any worktree
