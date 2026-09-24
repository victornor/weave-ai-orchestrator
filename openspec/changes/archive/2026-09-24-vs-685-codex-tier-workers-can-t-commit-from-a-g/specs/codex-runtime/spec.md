## ADDED Requirements

### Requirement: A workspace-write Codex turn can write its worktree's git metadata

When a Codex turn runs under the `workspace-write` sandbox (permission mode `auto`), the adapter
SHALL add the checkout's git common directory as an additional sandbox writable root, so the
per-worktree metadata a git worktree stores under the main clone's `.git/worktrees/<name>/`
(such as `index.lock` and `HEAD`) is writable. The adapter SHALL resolve that directory from the
run's checkout: a `.git` directory is itself the common directory; a linked worktree's `.git`
file (`gitdir: <gitdir>`) resolves through `<gitdir>/commondir`. When the checkout lies outside
the turn's working directory, the adapter SHALL add the checkout as a writable root too. The
adapter SHALL add roots only to a `workspace-write` turn: `restricted` stays `read-only` and
`bypass` stays unsandboxed. A checkout whose git directory cannot be resolved SHALL NOT fail the
turn.

#### Scenario: A Codex worker commits from its worktree checkout

- **WHEN** a Codex worker in `auto` mode runs in a git worktree whose common dir is outside its working directory
- **THEN** its invocation carries the git common directory among `sandbox_workspace_write.writable_roots`
- **AND** `git add` and `git commit` inside the checkout succeed instead of failing with a read-only filesystem error

#### Scenario: A resumed or forked worker keeps the writable root

- **WHEN** an `auto` Codex worker resumes or forks a session in the same worktree
- **THEN** that invocation carries the git common directory among its writable roots as well

#### Scenario: Read-only and bypass turns gain no root

- **WHEN** a Codex turn runs in `restricted` or `bypass` mode
- **THEN** its invocation carries no `sandbox_workspace_write.writable_roots`

#### Scenario: An unresolvable checkout does not fail the turn

- **WHEN** the run's checkout has no readable `.git` file or directory
- **THEN** the turn runs with the same sandbox it has today and is not failed by the missing root
