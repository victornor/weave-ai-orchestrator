## Purpose

Ensures every worker worktree has the workspace's configured Git identity available even when the worker runtime uses an isolated HOME, and makes missing identity configuration an actionable provisioning error.

## ADDED Requirements

### Requirement: Worker provisioning resolves a configured Git identity

When provisioning a worker worktree, the system SHALL resolve `user.name` and `user.email` using Git's normal configuration precedence for the project's repository. The project repository's configured identity is the source of truth; the system SHALL NOT substitute a placeholder identity.

#### Scenario: Repository identity is configured

- **WHEN** the project's repository resolves both `user.name` and `user.email`
- **THEN** worker provisioning uses those exact values as the worktree's Git identity

#### Scenario: Repository identity is incomplete

- **WHEN** the project's repository resolves only one of `user.name` or `user.email`
- **THEN** provisioning fails before a worker worktree is created and the error names the missing setting

### Requirement: Missing Git identity fails at provisioning

If neither the repository configuration nor the configuration visible to the daemon provides both required values, worker provisioning SHALL fail before binding the ticket or leaving a worker worktree behind. The error SHALL identify `user.name` and/or `user.email` as the settings to configure.

#### Scenario: No identity is configured

- **WHEN** the project repository resolves neither `user.name` nor `user.email`
- **THEN** provisioning fails with a clear configuration error naming both settings and does not proceed to a later commit or rebase

### Requirement: An isolated HOME does not change worker commit metadata

After successful provisioning, Git operations performed in the worker worktree SHALL be able to create commits and rebase with the resolved identity when HOME is empty or isolated. Resulting commits SHALL record the resolved name and email for both author and committer unless the Git operation explicitly supplies different metadata.

#### Scenario: Commit and rebase with an empty HOME

- **WHEN** a worker creates a commit and rebases its branch while its HOME contains no Git configuration
- **THEN** both operations succeed and the resulting commit metadata uses the configured identity
