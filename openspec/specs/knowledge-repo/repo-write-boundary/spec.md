# knowledge-repo/repo-write-boundary Specification

## Purpose
Guarantees that committing knowledge into a repository can never leak workspace-wide or cross-project content into that repository, regardless of which write path produced it.

## Requirements

### Requirement: Only a project's own project-scope knowledge can ever be written into a repository

Every mechanism this capability introduces for writing knowledge into a git repository (the worker write path, the curation and weaver write path, and merge-time reconciliation) SHALL write only files that fall under that project's own `knowledge/projects/<projectId>/**` in the workspace's knowledge store. This SHALL be enforced by a check on the path itself, not left to the caller to get right.

#### Scenario: A worker's own project write is allowed

- **WHEN** a worker in an opted-in project writes a note or document scoped to its own project
- **THEN** the write is permitted to reach the repository

#### Scenario: The workspace hub can never reach a repository

- **WHEN** any write path this capability introduces is asked, directly or through a bug in a caller, to write the workspace hub file, the shared knowledge file, or the decisions log into a project's repository
- **THEN** the write is refused before anything is written to disk

#### Scenario: Another project's knowledge can never reach a repository

- **WHEN** any write path this capability introduces is asked to write one project's knowledge into a different project's repository
- **THEN** the write is refused before anything is written to disk

### Requirement: The boundary is exercised by tests, not left to review

The refusal in the previous requirement SHALL be covered by an automated test for each of: a workspace-scope file, a shared-scope file, the decisions log, and a foreign project's file — each attempted against a repository write path this capability introduces.

#### Scenario: Automated coverage exists

- **WHEN** the test suite for this capability runs
- **THEN** it includes a case for each excluded scope proving the write path refuses it
