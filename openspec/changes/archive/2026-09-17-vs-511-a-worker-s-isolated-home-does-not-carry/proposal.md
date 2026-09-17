## Why

Workers run with isolated HOME directories, so Git can lose the operator's configured identity at the exact point an approved ticket needs a commit or rebase. The resulting exit 128 looks like a retryable runtime failure and strands otherwise valid work; identity availability must be established when the worker worktree is provisioned.

## What Changes

- Resolve the Git author/committer name and email from the project's repository configuration using Git's normal configuration precedence.
- Refuse worker worktree provisioning with a clear error naming the missing Git setting when either `user.name` or `user.email` is unavailable, before creating a worktree or binding the worker.
- Pass the resolved identity to worker child processes through Git's author and committer environment variables, so commits and rebases continue to use it even when HOME is isolated.
- Cover successful commit and rebase behavior with an empty HOME, the configured identity in resulting commits, and the early missing-identity provisioning failure.

## Capabilities

### New Capabilities

- `worker-git-identity`: Defines how worker Git operations obtain an explicit workspace/project identity and how provisioning fails when it is unavailable.

### Modified Capabilities

<!-- No existing specification currently defines worker worktree identity behavior. -->

## Impact

- `packages/core` worker worktree provisioning and run-launch environment.
- Git utility/configuration resolution and worker tests.
- No database migration or external dependency is required; existing workspace/project Git configuration remains the source of truth.
