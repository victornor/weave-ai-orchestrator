## MODIFIED Requirements

### Requirement: The overview offers a sync action that fast-forwards a behind clone

The project overview SHALL offer an action that brings a `behind` clone's `HEAD` to match
`origin/<landingBranch>` by fast-forwarding it. On success, the overview's sync state SHALL update to
`in_sync` without requiring a page reload.

The same action, run against a `diverged` clone, SHALL first attempt the guarded recovery defined by
`project-overview/clone-recovery`. When that recovery resolves the divergence, the overview's sync state
SHALL update to `in_sync` without requiring a page reload, the same as a successful fast-forward. When it
does not — the clone holds a commit not present on the remote — the action SHALL NOT silently do
nothing: it SHALL report that the fast-forward could not be performed and why, and the clone's sync state
SHALL remain `diverged`. In neither case SHALL the action discard a commit the clone holds to force it to
match the remote.

#### Scenario: Syncing a behind clone

- **WHEN** the sync action is used against a project whose clone is `behind`
- **THEN** the clone is fast-forwarded to the remote's tip and the overview shows `in_sync` without a
  reload

#### Scenario: Syncing a diverged clone that recovers

- **WHEN** the sync action is used against a project whose clone is `diverged` only because the remote's
  history was rewritten since the clone's branch was last confirmed to match it
- **THEN** the clone's branch is reset to match the remote's current tip and the overview shows `in_sync`
  without a reload, the same as a successful fast-forward

#### Scenario: Syncing a diverged clone reports rather than pretends to fix

- **WHEN** the sync action is used against a project whose clone is `diverged` because it holds a commit
  not present on the remote
- **THEN** the action reports that it could not fast-forward and why, the clone is unchanged, and the
  overview continues to show `diverged`
