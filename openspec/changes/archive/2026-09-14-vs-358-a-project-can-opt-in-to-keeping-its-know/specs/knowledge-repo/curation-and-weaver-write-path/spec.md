## Purpose

Covers the two knowledge writers that do not already hold a ticket-scoped worktree — a curation run and a weaver's own out-of-ticket edit — so their writes to an opted-in project also reach the repository, through a reviewed pull request rather than a silent direct push.

## ADDED Requirements

### Requirement: A curation run for an opted-in project gets a real worktree

Requesting curation for a project that has opted in to a knowledge repository SHALL spawn the curation worker with a worktree and branch, instead of the read-only, worktree-less spawn used for an opted-out project.

#### Scenario: Curation requested for an opted-in project

- **WHEN** curation is requested for a project with knowledge-repo enabled
- **THEN** the curation worker is given a worktree and branch it can commit to

#### Scenario: Curation requested for an opted-out project

- **WHEN** curation is requested for a project with knowledge-repo disabled
- **THEN** the curation worker is spawned exactly as before, with no worktree

### Requirement: A curation rewrite for an opted-in project delivers through the project's normal review

A curation run's rewrite of an opted-in project's knowledge SHALL be delivered through that project's configured delivery mode — a pull request awaiting a merge approval, or a local branch, matching how any other ticket for that project delivers — rather than committed and merged with no review.

#### Scenario: A curation ticket finishes for an opted-in project

- **WHEN** a curation worker for an opted-in project finishes its rewrite
- **THEN** the change is delivered as the project's other tickets are, and lands only once that delivery's normal approval is granted

### Requirement: A weaver's out-of-ticket knowledge write to an opted-in project opens a pull request

A weaver write to an opted-in project's knowledge made with no ticket in progress (for example, updating that project's "Current focus") SHALL be committed onto a dedicated branch and opened as a pull request against the project's landing branch, never pushed directly to it.

#### Scenario: A weaver updates a project's current focus

- **WHEN** the weaver writes to an opted-in project's knowledge outside of any ticket
- **THEN** a branch carrying that change is pushed and a pull request against the project's landing branch is opened, and the landing branch itself is never written to directly

#### Scenario: A weaver writes to an opted-out project's knowledge

- **WHEN** the weaver writes to an opted-out project's knowledge outside of any ticket
- **THEN** behavior is unchanged — the write reaches only the workspace's own knowledge store

### Requirement: A weaver's out-of-ticket pull request never carries another ticket's unmerged content

When a weaver's out-of-ticket note is committed to the repository, the committed content SHALL contain only that write's own contribution applied to what has already landed — never a different, still-unmerged ticket's own note on the same hub or document, even though that other note may already be present in the workspace's own knowledge store at the moment of this write.

#### Scenario: A ticket's unmerged note and the weaver's out-of-ticket note on the same hub

- **WHEN** a worker's ticket has appended a knowledge note to an opted-in project's hub and has not yet landed, and the weaver separately appends a note to the same hub outside any ticket
- **THEN** the weaver's pull request branch contains only the weaver's own note, not the ticket's

### Requirement: Concurrent out-of-ticket writes to the same project never race and lose one

Two out-of-ticket knowledge writes to the same opted-in project, made without either waiting for the other to finish, SHALL both reach the repository — neither SHALL fail silently because the other was still in progress.

#### Scenario: Two writes fired without awaiting between them

- **WHEN** the weaver makes two out-of-ticket knowledge writes to the same opted-in project without waiting for the first to complete before starting the second
- **THEN** both writes' commits are present on the resulting branch and pull request

### Requirement: A second out-of-ticket write before the first pull request merges never loses the first

When a weaver makes a second out-of-ticket knowledge write to an opted-in project while an earlier such write's pull request is still open, the resulting pull request SHALL carry both writes — the second SHALL be added to the existing branch, never replace it.

#### Scenario: Two out-of-ticket writes to different files

- **WHEN** the weaver writes to two different knowledge files of the same opted-in project, out of ticket, before the first write's pull request has merged
- **THEN** one open pull request carries both files' changes

#### Scenario: Two out-of-ticket writes to the same file

- **WHEN** the weaver writes to the same knowledge file of an opted-in project twice, out of ticket, before the first write's pull request has merged
- **THEN** the open pull request's content reflects the second write, and the branch's commit history still contains the first write's commit

### Requirement: The weaver's write is visible in the workspace immediately, its repository copy once the pull request merges

The weaver's out-of-ticket write SHALL be reflected in the workspace's own knowledge store the moment it is made, exactly as today. Its presence in the project's repository SHALL depend on that pull request being merged, like any other pull request.

#### Scenario: Reading the write before the pull request merges

- **WHEN** an agent reads the opted-in project's knowledge after the weaver's out-of-ticket write but before its pull request has merged
- **THEN** it sees the new content in the workspace's own knowledge store
