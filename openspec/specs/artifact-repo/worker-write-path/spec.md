# artifact-repo/worker-write-path Specification

## Purpose
Lets a worker's published ticket artifact also reach an opted-in project's own repo, committed and reviewed alongside the ticket's other changes, the same way VS-358 mirrors a knowledge write.

## Requirements

### Requirement: Publishing an artifact for an opted-in project also mirrors it into the worktree

When a worker publishes a ticket artifact for a project with `knowledgeRepo.enabled` set, and the publishing agent has a worktree, the system SHALL also write the artifact's HTML, and a metadata file carrying its `title`/`kind`, into that worktree under `.weave/artifacts/<TICKET-IDENTIFIER>/<key>` — in addition to, and independent of, the existing stored ticket document and work product, which SHALL be written exactly as they are for an opted-out project.

#### Scenario: Publishing an artifact for an opted-in project

- **WHEN** a worker with a worktree calls the artifact-publishing tool on a ticket belonging to a project with `knowledgeRepo.enabled` set
- **THEN** the call succeeds exactly as it does today (a URL and a revision number), the ticket document and work product are stored as before, and the worktree gains `.weave/artifacts/<TICKET-IDENTIFIER>/<key>.html` containing the published HTML and a matching metadata file carrying the call's `title`/`kind`

#### Scenario: Republishing under the same key updates the mirrored file

- **WHEN** a worker publishes a second time under a key that already has a mirrored file in its worktree
- **THEN** the mirrored `.html` file's content, and the metadata file's `title`/`kind`, are replaced with this call's own values — the mirror is never merged with, or appended to, its previous content

### Requirement: An opted-out project's publish is unaffected

When the project has not opted in, or the publishing agent has no worktree, publishing an artifact SHALL behave exactly as it does today: no file is written anywhere outside the existing ticket document and work product storage.

#### Scenario: Publishing for an opted-out project

- **WHEN** a worker publishes a ticket artifact for a project with `knowledgeRepo.enabled` not set
- **THEN** the call succeeds exactly as today and no file is written into any worktree

#### Scenario: Publishing with no worktree

- **WHEN** the publishing agent has no worktree (for example, a weaver publishing a workspace-scoped artifact has none to mirror into)
- **THEN** the call succeeds exactly as today and no file is written into any worktree
