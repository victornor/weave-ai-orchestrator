## Purpose

Stops a secret-shaped credential from ever being committed into a repo through the artifact mirror path, matching the refusal VS-358 already applies to a knowledge write bound for a repo.

## ADDED Requirements

### Requirement: A mirror-bound artifact is refused when it looks like it carries a secret

When an artifact publish would mirror into an opted-in project's worktree, the system SHALL check the HTML against the same secret-shaped-content pattern used for knowledge, and SHALL refuse the entire publish — recording nothing, mirroring nothing — when it matches.

#### Scenario: Publishing artifact HTML containing an API-key-shaped token for an opted-in project

- **WHEN** a worker publishes an artifact whose HTML contains a string matching the secret-shaped pattern (an API-key-shaped token, a credentialed URL, or a PEM private-key block), for a project with `knowledgeRepo.enabled` set
- **THEN** the call fails with a validation error, and neither the ticket document, the work product, nor any mirrored file is created or modified

### Requirement: An opted-out project's publish is not subject to this check

The secret-shaped-content check introduced by this capability SHALL apply only on the path that would mirror into a repo; it SHALL NOT change the outcome of publishing an artifact for a project that has not opted in.

#### Scenario: The same content published for an opted-out project

- **WHEN** a worker publishes the same secret-shaped HTML for a project with `knowledgeRepo.enabled` not set
- **THEN** the call succeeds exactly as it did before this change
