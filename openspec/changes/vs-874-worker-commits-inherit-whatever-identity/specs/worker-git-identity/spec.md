## MODIFIED Requirements

### Requirement: Worker provisioning resolves a configured Git identity

A worker's commit identity SHALL be decided from configuration, not read from the project's
repository. The system SHALL resolve it, in order, from the project's `workerGitIdentity`, the
workspace's `defaults.workerGitIdentity`, and a non-personal default derived from the repository URL.
The project's value SHALL win when both are configured. The repository's own `user.name` and
`user.email` SHALL NOT be used for a worker's identity, whether or not they are configured.

With neither the project nor the workspace configured, the default SHALL be `Weave AI` with
`<owner>@users.noreply.github.com` when the repository URL names a GitHub owner, and
`weave-ai@users.noreply.github.com` otherwise. It SHALL never be the identity the repository happens
to have configured for the person who cloned it.

Provisioning SHALL NOT fail because the repository has an incomplete or absent identity: the
repository's identity no longer takes part in provisioning a worker's checkout.

#### Scenario: A project override wins over the workspace and the repository

- **WHEN** a project sets `workerGitIdentity`, the workspace sets a different `defaults.workerGitIdentity`, and the clone is configured as a third identity
- **THEN** the worker's commits use the project's identity

#### Scenario: The workspace default applies to a project with no override

- **WHEN** the project sets no `workerGitIdentity`, the workspace sets `defaults.workerGitIdentity`, and the clone is configured as a personal identity
- **THEN** the worker's commits use the workspace's identity, not the clone's

#### Scenario: Nothing configured derives a non-personal default from a GitHub remote

- **WHEN** neither the project nor the workspace sets a worker identity, and the repository URL is `git@github.com:acme/api.git`
- **THEN** the worker's identity is `Weave AI <acme@users.noreply.github.com>`

#### Scenario: Repository identity is configured

- **WHEN** the clone resolves both `user.name` and `user.email` as a personal address such as `1-1@hotmail.dk`, and neither the project nor the workspace sets a worker identity
- **THEN** the worker commits as the derived non-personal default, not as those values, and no worker commit carries the personal address

#### Scenario: Repository identity is incomplete

- **WHEN** the clone resolves only one of `user.name` or `user.email`
- **THEN** worktree provisioning succeeds and the worker commits as the resolved configured or default identity

### Requirement: An isolated HOME does not change worker commit metadata

After successful provisioning, Git operations performed in the worker worktree SHALL create commits
and rebase under the configured worker identity when HOME is empty or isolated. Resulting commits
SHALL record that name and email for both author and committer unless the Git operation explicitly
supplies different metadata.

#### Scenario: Commit and rebase with an empty HOME

- **WHEN** a worker creates a commit and rebases its branch while its HOME contains no Git configuration
- **THEN** both operations succeed and the resulting commit metadata uses the configured worker identity

## REMOVED Requirements

### Requirement: Missing Git identity fails at provisioning

**Reason**: The repository's identity is no longer the source of a worker's identity. Failing
provisioning when the clone lacks `user.name` or `user.email` was the other half of the inheritance
bug: it made a human's clone configuration a prerequisite for machine work. A workspace or project
identity, or the derived non-personal default, now always answers the question, so there is no missing
identity to report.

**Migration**: None. Nothing stored or configured changes; a clone that lacked an identity simply
provisions again. Its `user.name`/`user.email` remain untouched, because this change never writes to
the clone.

## ADDED Requirements

### Requirement: The identity is written into the worktree when it is created

The resolved worker identity SHALL be applied as the checkout's own Git configuration when the
worktree is created, not only at commit time. A process run inside the worktree SHALL therefore
resolve the configured identity through Git's normal precedence, including a tool that shells out to
`git` without any identity environment variables. The same resolved identity SHALL be handed to the
worker turn's runtime environment.

The system SHALL NOT repair, rewrite or re-point an existing worktree as part of this: a worktree
created before the setting existed keeps the configuration it has until it is replaced.

#### Scenario: Git resolves the configured identity inside a new worktree

- **WHEN** a worker worktree is provisioned with a configured identity and `git var GIT_AUTHOR_IDENT` runs inside it with no `GIT_AUTHOR_*`/`GIT_COMMITTER_*` environment variables
- **THEN** the output names the configured name and email, not the clone's

#### Scenario: A shelled-out Git tool commits as the configured identity

- **WHEN** a worker runs a tool that creates a Git commit in its worktree without the daemon supplying metadata
- **THEN** the commit's author and committer are the configured worker identity

### Requirement: A personal-looking clone identity is reported once per project

At daemon startup the system SHALL examine each ready project whose clone commits under a personal
address while neither the project nor the workspace configures a worker identity. For each such
project it SHALL emit **one** warning naming the project and the address, and SHALL record that the
project has been reported so the warning is not repeated on a later startup.

A project with a configured worker identity SHALL NOT be reported. A project whose clone already
commits under a non-personal address (a `users.noreply.github.com` address, or a `noreply`/`no-reply`
local part) SHALL NOT be reported.

#### Scenario: An affected project is reported once

- **WHEN** a ready project's clone commits as `1-1@hotmail.dk`, no worker identity is configured, and the daemon starts
- **THEN** one warning names that project and that address; a second startup with the same condition emits none

#### Scenario: A correctly configured project is silent

- **WHEN** the project or the workspace configures a worker identity, whatever the clone commits as
- **THEN** no warning is emitted for that project

#### Scenario: A non-personal clone identity is silent

- **WHEN** the clone already commits as `1234+acme@users.noreply.github.com`
- **THEN** no warning is emitted for that project
