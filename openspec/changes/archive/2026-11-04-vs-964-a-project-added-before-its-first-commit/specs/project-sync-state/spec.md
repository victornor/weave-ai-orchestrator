## Purpose

How a project's primary clone compares to its remote's landing branch, and in particular that a remote with no commits yet is its own, non-alarming condition that resolves on the next fetch.

## ADDED Requirements

### Requirement: An empty remote is its own sync state

A project's sync state SHALL be `empty`, never `diverged`, when its clone's remote has no commits: after a fetch the clone has an unborn HEAD and no `origin` remote-tracking refs. `projects.fetch` SHALL record `empty` without touching the clone, and `projects.checkSync` SHALL return it with `behindBy: null` and a `message` stating that the remote has no commits yet and that the clone will pick them up on the next fetch. A project whose clone has any commit or any `origin` ref SHALL be classified exactly as before.

#### Scenario: A clone of an empty remote reports empty
- **WHEN** a project is added against a remote with no commits and its sync is checked
- **THEN** the state is `empty`, `behindBy` is null, and `message` names the next fetch

#### Scenario: The first commit resolves it
- **WHEN** a commit is pushed to the previously empty remote and the project is fetched
- **THEN** the clone fast-forwards, the state becomes `in_sync` and the synced head is recorded

#### Scenario: A genuinely diverged clone is unchanged
- **WHEN** the remote's history was rewritten so the clone holds a commit it no longer recognises
- **THEN** the state is `diverged` as before

### Requirement: Every place the state is shown explains it

The project page SHALL show `empty` as a neutral "No commits yet" tag with the message, not the alarm tone of `diverged`. The curation freshness gate SHALL block with text saying the remote has no commits yet and will be picked up on the next fetch.

#### Scenario: The project page
- **WHEN** the sync check returns `empty`
- **THEN** the page shows "No commits yet" and the message, and no alarm styling

### Requirement: Giving a worker a worktree fetches an empty project once

Before a worker's worktree is created for a project whose state is `empty`, the daemon SHALL run one fetch and re-read the project. It SHALL NOT retry or loop: if the remote is still empty the state stays `empty` and the worktree step proceeds as it would have. A project in any other state SHALL NOT be fetched by this step.

#### Scenario: Commit arrived since the last sweep
- **WHEN** a worker is provisioned on an `empty` project whose remote now has a commit
- **THEN** one fetch runs, the project becomes `in_sync`, and the worktree is created from the new tip

#### Scenario: Still empty
- **WHEN** a worker is provisioned on an `empty` project whose remote is still empty
- **THEN** exactly one fetch runs and the state remains `empty`
