## Purpose

Keeps the workspace's own knowledge copy — what search, budgets, curation, links, health and bootstrap digests all read — agreeing with what has actually landed in an opted-in project's repository, at the moment each of that project's tickets lands.

## ADDED Requirements

### Requirement: The workspace knowledge copy is reconciled only against what a landing actually changed

When a ticket belonging to a project with knowledge-repo enabled lands, the daemon SHALL reconcile the workspace's own `knowledge/projects/<id>/**` copy only against the knowledge files that landing itself added, changed or removed under the repository's `.weave/knowledge/` — never against files that landing left untouched, however much they may differ from the workspace copy for an unrelated reason.

#### Scenario: A landed ticket's knowledge change is reflected

- **WHEN** a ticket that changed `.weave/knowledge/PROJECT.md` lands for an opted-in project
- **THEN** the workspace's own copy of that project's hub file reflects what that landing added to or removed from it

#### Scenario: An unrelated landing never touches knowledge it did not change

- **WHEN** a ticket that made no change under `.weave/knowledge/` lands for an opted-in project
- **THEN** the project's workspace knowledge copy is not reconciled at all, regardless of whether it currently differs from the repository for some other reason

#### Scenario: A resolved merge conflict is reflected as landed

- **WHEN** a ticket's knowledge change required a conflict resolution during landing, and the resolved content differs from what any single write had produced
- **THEN** the workspace copy after landing includes the resolved, landed content

#### Scenario: A document deleted in the repository

- **WHEN** a landed ticket removed a linked document from `.weave/knowledge/docs/`, and nothing has written to that document in the workspace since
- **THEN** the workspace's copy of that document is removed too

### Requirement: Reconciliation never discards a knowledge write that has not landed yet

A knowledge entry or document present in the workspace copy but not yet part of any landed commit — another ticket's still-open note, or a weaver's out-of-ticket pull request not yet merged — SHALL survive an unrelated ticket's landing for the same project, and SHALL NOT be reverted or deleted by that landing's reconciliation.

#### Scenario: An unmerged ticket's note survives an unrelated landing

- **WHEN** ticket A has appended a knowledge note to an opted-in project's hub and has not yet landed, and an unrelated ticket B for the same project lands
- **THEN** ticket A's note is still present in the workspace copy after B's landing completes

#### Scenario: A pending weaver pull request's edit survives an unrelated landing

- **WHEN** the weaver has an open pull request carrying an out-of-ticket edit to an opted-in project's knowledge, and an unrelated ticket for the same project lands before that pull request merges
- **THEN** the pending edit's content is still present in the workspace copy after that landing completes

#### Scenario: A landing's own legitimate removal still applies

- **WHEN** a ticket's own landed change removed a knowledge entry that existed before that ticket started
- **THEN** the workspace copy reflects that removal, without removing an unrelated entry a different, still-unmerged ticket added to the workspace copy in the meantime

### Requirement: The reconciliation is recorded and reindexed

Each file the reconciliation changes SHALL record a new knowledge revision attributing it to the merge, and the knowledge search and link index SHALL reflect the reconciled content once reconciliation completes.

#### Scenario: History after a merge-time reconciliation

- **WHEN** a project's knowledge file is reconciled at merge time
- **THEN** its revision history shows a new revision attributed to the merge, distinct from an agent's direct write

#### Scenario: Search after a merge-time reconciliation

- **WHEN** a project's knowledge file changes only through merge-time reconciliation (for example, a human's direct edit to the repository file merged through an unrelated pull request)
- **THEN** a knowledge search for its new content finds it

### Requirement: Reconciliation never touches an opted-out project

A project that has not opted in to a knowledge repository SHALL NOT be reconciled — its landing behaves exactly as it did before this capability existed.

#### Scenario: A ticket lands for an opted-out project

- **WHEN** a ticket for a project with knowledge-repo disabled lands
- **THEN** no reconciliation runs and the workspace's knowledge copy is affected only by the writes agents already made through the knowledge tools
