## Purpose

Guarantees that only the artifact being published on its own ticket can ever be written into a repo, and that a workspace-scoped (weaver) artifact — which describes the portfolio, not one project — can never reach any project's repo.

## ADDED Requirements

### Requirement: A mirror write only ever targets the publishing ticket's own path

The boundary between a ticket's stored artifact and a repo file SHALL be enforced by a single check that a mirror write's destination is `<TICKET-IDENTIFIER>/<key>`, where `TICKET-IDENTIFIER` is the identifier of the ticket the artifact is being published on. No caller-supplied or derived path may cross this boundary at another ticket's identifier or above the per-ticket directory.

#### Scenario: The mirror path is derived only from the publishing ticket and key

- **WHEN** an artifact is published on ticket `ACME-42` under key `plan-diagram`
- **THEN** the only path a mirror write may target is `.weave/artifacts/ACME-42/plan-diagram.html` (and its metadata file) — never a path naming a different ticket, and never a path above the per-ticket directory

### Requirement: A workspace-scoped artifact is never written to any repo

Publishing a workspace-scoped artifact (no ticket involved) SHALL never write into any project's repo, under any configuration.

#### Scenario: A weaver publishes a workspace artifact for an opted-in project's workspace

- **WHEN** the weaver publishes a workspace-scoped artifact, regardless of whether any project in the workspace has `knowledgeRepo.enabled` set
- **THEN** no file is written into any project's worktree or repo; the artifact is stored only in the workspace's own artifact store, exactly as today

### Requirement: A mismatched or unresolved key never gets an implicit path

If the mirror boundary check would require inventing a path not already determined by the publishing ticket's own identifier and the call's own key, the write SHALL be refused rather than guessed.

#### Scenario: Internal misuse of the boundary helper

- **WHEN** code elsewhere in the daemon calls the boundary helper with a path that does not belong to the ticket it claims to be publishing for
- **THEN** the helper throws rather than returning a path, and no file is written
