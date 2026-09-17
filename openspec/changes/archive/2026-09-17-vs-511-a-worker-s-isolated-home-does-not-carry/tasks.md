## 1. Git identity resolution

- [x] 1.1 Add a core Git helper that reads `user.name` and `user.email` with Git's normal repository configuration precedence, returns the complete identity, and reports each missing setting; verify it distinguishes complete, partial, and absent configuration.
- [x] 1.2 Add worktree identity materialization using Git worktree-specific configuration, including the required Git extension setup; verify it does not alter the project's primary checkout configuration.

## 2. Worker provisioning integration

- [x] 2.1 Run identity preflight before ticket worktree creation and apply the resolved identity after provider creation; verify missing identity aborts provisioning before worktree/ticket binding and uses a clear `user.name`/`user.email` error.
- [x] 2.2 Apply the same identity guard and materialization to planner worktree provisioning; verify its rollback leaves no partial worker or worktree state on failure.

## 3. Regression coverage

- [x] 3.1 Add an integration regression that provisions a worktree with an empty HOME, creates a commit, rebases it, and asserts author/committer name and email match the configured identity.
- [x] 3.2 Add failure-path coverage for missing and incomplete identities and run the affected core test suites, typecheck, lint, and the full test command to verify the complete change.
