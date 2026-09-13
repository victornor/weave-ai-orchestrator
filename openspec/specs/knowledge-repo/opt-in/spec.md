# knowledge-repo/opt-in Specification

## Purpose
Lets a project opt in to also committing its knowledge into its own git repository, off by default, so nothing about an existing project's knowledge behavior changes until a human deliberately turns it on.

## Requirements

### Requirement: A project has a knowledge-repo opt-in flag, off by default

Every project SHALL have a `knowledgeRepo.enabled` setting. A project declared with no such setting, or created before this capability existed, SHALL behave as `enabled: false`.

#### Scenario: A newly declared project with no knowledgeRepo setting

- **WHEN** a project is added with no `knowledgeRepo` field in its configuration
- **THEN** its knowledge-repo opt-in is `false`

#### Scenario: An existing project after this capability ships

- **WHEN** a project that predates this capability is read
- **THEN** its knowledge-repo opt-in reads as `false` until a human explicitly turns it on

### Requirement: An opted-out project's knowledge behavior is unchanged

While a project's knowledge-repo opt-in is `false`, every knowledge read, write, curation, budget, search, health and bootstrap-digest behavior SHALL be identical to a workspace that has never heard of this capability. No file is written into, or read from, that project's git repository on its account.

#### Scenario: A worker writes a knowledge note in an opted-out project

- **WHEN** a worker calls the knowledge-note tool for a project with knowledge-repo disabled
- **THEN** the write lands in the workspace's own knowledge store exactly as before, and nothing is written into the project's repository or its worktree

#### Scenario: A curation run in an opted-out project

- **WHEN** a curation run is requested for a project with knowledge-repo disabled
- **THEN** it runs exactly as before, with no worktree, branch or pull request

### Requirement: The opt-in can be turned on for a project

A human SHALL be able to set a project's `knowledgeRepo.enabled` to `true` through the same configuration path used for the project's other settings.

#### Scenario: Turning the flag on

- **WHEN** a human sets `knowledgeRepo.enabled` to `true` for a project
- **THEN** the project's knowledge-repo behavior (worker write path, curation and weaver write path, merge-sync) applies to that project's subsequent writes and merges

Turning the flag on or off for a project that already holds knowledge, including migrating its existing content into or out of the repository, is out of scope for this capability and is handled by a dedicated follow-up.
