## Context

The daemon provisions ticket and planner worktrees through registered providers. The worker runtime later runs Git commands from an isolated agent home, while the existing identity is only discoverable through Git configuration visible during provisioning. See `proposal.md` and the `worker-git-identity` delta for the externally visible contract.

## Goals / Non-Goals

**Goals:**

- Resolve one complete identity before any worker worktree is created.
- Make the identity independent of the runtime's HOME and available to ordinary Git commands, including rebase commit steps.
- Apply the same guard to ticket workers and planner worktrees that use the shared provisioning paths.
- Preserve existing Git configuration precedence and fail clearly rather than inventing metadata.

**Non-Goals:**

- Adding a second workspace identity setting or a database field for name/email.
- Changing author metadata when a worker explicitly supplies Git author/committer values.
- Configuring identities for the daemon's own knowledge/archive commits, which already use their explicit service identity.

## Decisions

### Resolve from the project repository's Git configuration

The provisioning code will query `user.name` and `user.email` against the project's clone using Git's standard precedence. This preserves a project's local configuration while still allowing the daemon-visible global/system configuration to supply values, matching how Git currently determines the intended identity. An explicit workspace YAML setting was rejected because it would create a new source of truth and require UI/config migration; hard-coded service values were rejected because they would produce misleading commits.

### Materialize identity in the linked worktree's worktree config

After the provider creates the checkout, the core provisioning path will enable Git's `extensions.worktreeConfig` for the repository and write the resolved `user.name` and `user.email` with `git config --worktree` from the new worktree. This keeps the values attached to the worker checkout and avoids relying on the runtime's HOME or on a remembered environment overlay. The setup happens only after the preflight identity check, so a missing identity cannot leave a worktree behind.

Passing only `GIT_AUTHOR_*`/`GIT_COMMITTER_*` through the runtime was rejected as the sole mechanism because it would cover daemon-launched turns but not a human or tool invoking Git in the checkout, and would require carrying values across turns. Writing ordinary repository-local config was rejected because linked worktrees share that config and could unexpectedly alter the project's primary checkout; worktree config scopes the values correctly.

### Centralize preflight and materialization around provisioning

The shared worker provisioning helper will resolve and apply the identity, and the planner's equivalent provider path will use the same helper. Provider interfaces remain unchanged: providers create and remove worktrees, while core owns the Git-specific invariant for its built-in worker checkout lifecycle.

## Risks / Trade-offs

- [Risk] Older Git installations may not support worktree-specific configuration. → Treat failure to enable or write the worktree config as a provisioning error and include the Git command's actionable message; do not silently fall back to HOME-dependent behavior.
- [Risk] A project can change its configured identity after a worker is provisioned. → The worktree stores the resolved values at creation, giving an in-flight ticket stable metadata; a later worker gets the then-current project configuration.
- [Risk] A custom non-Git worktree provider may not return a checkout accepted by `git config --worktree`. → The core path reports the provider/configuration failure during provisioning, preserving the early-failure contract; built-in providers are the supported Git worker path.

## Migration Plan

No data migration is required. Existing worktrees retain their current configuration and are not rewritten; newly provisioned worker and planner worktrees receive the invariant. If a workspace has no identity configured, the next provisioning attempt fails with the named Git settings, after which configuring the project's Git identity allows retry.
