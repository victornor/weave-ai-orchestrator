## MODIFIED Requirements

### Requirement: The opt-in can be turned on for a project

A human SHALL be able to set a project's `knowledgeRepo.enabled` to `true` through the same configuration path used for the project's other settings. For a project that already holds workspace-side knowledge, or that already has a repository copy under `.weave/knowledge/`, the setting SHALL change through the reviewed migration defined by `knowledge-repo/switch-migration` — the setting becomes enabled only when the migration's pull request merges — rather than being written immediately.

#### Scenario: Turning the flag on

- **WHEN** a human sets `knowledgeRepo.enabled` to `true` for a project
- **THEN** the project's knowledge-repo behavior (worker write path, curation and weaver write path, merge-sync) applies to that project's subsequent writes and merges

#### Scenario: Turning the flag on for a project that already holds knowledge

- **WHEN** a human sets `knowledgeRepo.enabled` to `true` for a project whose workspace knowledge is not empty
- **THEN** a reviewed migration begins, and the opt-in becomes enabled only once its pull request merges
