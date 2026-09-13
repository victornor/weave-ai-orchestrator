# project-overview/sync-status Specification

## Purpose
Tells the human when a project's clone has fallen behind its remote: the overview classifies it as
in sync, behind or diverged without mutating the clone, offers a fast-forward for a behind clone,
and does not raise an alarm for a clone that is only briefly behind.

## Requirements

### Requirement: A project's clone is classified against its remote as in sync, behind, or diverged

A project's primary clone SHALL be classified against `origin/<landingBranch>` as exactly one of:
`in_sync` (the clone's `HEAD` and the remote's tip are the same commit), `behind` (`HEAD` is an
ancestor of the remote's tip and the two differ — a fast-forward would resolve it), or `diverged`
(`HEAD` is not an ancestor of the remote's tip — a fast-forward is not possible). These SHALL be
mutually exclusive and SHALL cover every case a comparison against one remote ref can produce.

#### Scenario: Nothing has changed

- **WHEN** the clone's `HEAD` and `origin/<landingBranch>`'s tip are the same commit
- **THEN** the project is classified `in_sync`

#### Scenario: The remote moved forward

- **WHEN** the remote's tip has commits the clone does not, reachable by fast-forwarding the clone
- **THEN** the project is classified `behind`

#### Scenario: The remote's history was rewritten

- **WHEN** the clone's `HEAD` holds a commit the remote's current tip no longer recognises as its own
  history — the branch was force-pushed or rebased on the remote
- **THEN** the project is classified `diverged`, whether or not the remote also has new commits the
  clone lacks

### Requirement: Checking a project's sync state never mutates its clone

A check of a project's sync state SHALL be answerable without checking out a branch, merging, or
otherwise changing the clone's `HEAD` or working tree. It MAY update the clone's remote-tracking data
for the ref it checks, and SHALL NOT create, move or delete any other ref, commit, or working-tree
file, and SHALL NOT discard a commit the clone holds under any circumstance, including to make a
diverged clone appear to match its remote.

#### Scenario: Checking does not move the branch

- **WHEN** a project's sync state is checked and the clone is behind
- **THEN** the clone's checked-out branch and working tree are unchanged after the check

#### Scenario: Checking a diverged clone changes nothing

- **WHEN** a project's sync state is checked and the clone has diverged
- **THEN** no commit the clone holds is discarded or moved, and the clone is otherwise unchanged

### Requirement: The project overview shows the project's sync state

The project overview SHALL show a project's current sync state. A project that is `in_sync` SHALL
show nothing beyond what the overview already shows for a healthy project. A project that is
`behind` or `diverged` SHALL show which of the two it is, distinguishably from each other, without
requiring the human to open anything further to tell them apart.

A `diverged` project's overview SHALL say what happened — that the clone holds history the remote no
longer recognises — and that resolving it requires a human to act outside AgentConductor; it SHALL
NOT present the sync action as though it will fix a diverged clone.

#### Scenario: A project that is in sync

- **WHEN** the project overview is opened for a project whose clone is `in_sync`
- **THEN** nothing about its sync state is shown

#### Scenario: A project that is behind

- **WHEN** the project overview is opened for a project whose clone is `behind`
- **THEN** the overview shows that it is behind, distinguishable from a diverged project

#### Scenario: A project that has diverged

- **WHEN** the project overview is opened for a project whose clone has `diverged`
- **THEN** the overview shows that it has diverged, what that means, and that a human must resolve it
  outside AgentConductor

### Requirement: The sync state shown on the overview does not require a check per render

Determining the sync state shown on an already-open project overview SHALL NOT require a new check
of the remote for every render of that page. A check MAY be made once when the overview is opened for
a project, and SHALL NOT be repeated on that same visit merely because the page re-renders.

#### Scenario: Re-rendering does not re-check

- **WHEN** the project overview re-renders while already open — for example from an unrelated state
  change elsewhere on the page
- **THEN** no additional check of the project's sync state against its remote is made

### Requirement: The overview offers a sync action that fast-forwards a behind clone

The project overview SHALL offer an action that brings a `behind` clone's `HEAD` to match
`origin/<landingBranch>` by fast-forwarding it. On success, the overview's sync state SHALL update to
`in_sync` without requiring a page reload.

The same action, run against a `diverged` clone, SHALL NOT silently do nothing: it SHALL report that
the fast-forward could not be performed and why, and the clone's sync state SHALL remain `diverged`.
The action SHALL NOT discard a commit the clone holds to force it to match the remote.

#### Scenario: Syncing a behind clone

- **WHEN** the sync action is used against a project whose clone is `behind`
- **THEN** the clone is fast-forwarded to the remote's tip and the overview shows `in_sync` without a
  reload

#### Scenario: Syncing a diverged clone reports rather than pretends to fix

- **WHEN** the sync action is used against a project whose clone has `diverged`
- **THEN** the action reports that it could not fast-forward and why, the clone is unchanged, and the
  overview continues to show `diverged`

### Requirement: A briefly behind clone is not shown as an alarm

Because an ordinary merge landing on a project's remote routinely leaves its clone `behind` until the
next check catches it up, a `behind` state SHALL be shown with materially less visual severity than a
`diverged` state, both on the project overview and wherever else the state is shown. `behind` SHALL
NOT use the same alarm treatment reserved for a state that needs a human to act.

#### Scenario: Behind and diverged read differently

- **WHEN** one project is shown `behind` and another is shown `diverged`
- **THEN** the diverged project's indicator carries materially more visual severity than the behind
  project's, and the two are not shown with the same treatment
