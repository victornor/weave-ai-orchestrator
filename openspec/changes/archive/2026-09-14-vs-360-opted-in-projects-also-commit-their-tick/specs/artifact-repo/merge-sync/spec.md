## Purpose

Keeps a repo-committed artifact and its database record in agreement: an edit made directly on the landing branch — by a human, or by resolving a merge conflict — becomes a new artifact revision once a ticket for that project next lands, rendered through the same sandboxed viewer as any other revision.

## ADDED Requirements

### Requirement: A landed change to a mirrored artifact file becomes a new revision

When a ticket for a project with `knowledgeRepo.enabled` set lands, the system SHALL compare what actually changed under `.weave/artifacts/**` between the state before and after that landing. For each changed `<TICKET-IDENTIFIER>/<key>` pair whose `TICKET-IDENTIFIER` resolves to a ticket in that same project, if the landed HTML differs from what is currently stored for that key, the system SHALL record it as a new revision of that ticket's artifact, attributed to a system/merge actor, and update the artifact's `title`/`kind` from the metadata file when one is present in the landed state.

#### Scenario: A human edits an artifact directly on the landing branch

- **WHEN** a human edits `.weave/artifacts/ACME-42/plan-diagram.html` directly (not through the artifact-publishing tool), and a ticket for that project — any ticket, not necessarily `ACME-42` — subsequently lands
- **THEN** `ACME-42`'s `plan-diagram` artifact gains a new revision matching the edited HTML, attributed to a system/merge actor, and it renders through the existing sandboxed viewer exactly as any other revision does

#### Scenario: The worker's own publish is a no-op at merge time

- **WHEN** a worker publishes an artifact through the tool, its ticket lands, and the landed HTML is byte-for-byte what the tool already stored
- **THEN** landing does not create an additional revision for that artifact — the tool's own publish was the only revision-creating event

### Requirement: A landed body matching an older, non-current revision is a stale landing, not an update

If the landed HTML for a `<TICKET-IDENTIFIER>/<key>` pair matches an already-stored revision of that artifact other than its current one, the system SHALL treat it as a stale landing — the ticket's branch carries an older commit than what was already published — and SHALL leave the stored artifact untouched rather than reverting it, logging why.

#### Scenario: A worker publishes twice but the second commit never reached the landing branch

- **WHEN** a worker publishes an artifact under a key (recorded as revision 1), publishes again under the same key (recorded as revision 2), but the commit that lands only carries what revision 1's HTML looked like (the worktree's mirror file was never re-committed after the second publish)
- **THEN** landing does not create a new revision matching revision 1's content, the artifact's current revision remains revision 2, and the daemon logs that a stale landing was skipped

### Requirement: An unresolved ticket or key is left alone and logged

If a changed path's `TICKET-IDENTIFIER` does not resolve to a ticket in the landing project, or the file was deleted rather than added or modified, the system SHALL leave the stored artifact record untouched and SHALL log why, rather than guessing at an action or inventing a delete capability that does not otherwise exist.

#### Scenario: A changed path names a ticket outside the project

- **WHEN** a landed change under `.weave/artifacts/**` names a `TICKET-IDENTIFIER` that does not belong to the landing project
- **THEN** no artifact record is created or modified for that path, and the daemon logs that it was skipped

#### Scenario: An artifact file is deleted on the landing branch

- **WHEN** a landed change removes `.weave/artifacts/<TICKET-IDENTIFIER>/<key>.html` that previously existed
- **THEN** the stored artifact and its work product are left exactly as they were, and the daemon logs that the deletion was not applied

### Requirement: Reconciliation never touches an oversized or malformed landed body

A landed HTML body that fails the same validation the artifact-publishing tool already applies (empty, not recognizable as HTML, or over the stated size cap) SHALL NOT be recorded as a new revision.

#### Scenario: A landed file is over the size cap

- **WHEN** the landed HTML at a changed path exceeds the artifact size cap
- **THEN** no new revision is recorded for that path, and the daemon logs why

### Requirement: A pending, unrelated artifact publish is unaffected by another ticket's landing

Landing one ticket for a project SHALL only ever create or update revisions for the `<TICKET-IDENTIFIER>/<key>` paths its own diff actually changed; it SHALL NOT touch a different ticket's artifact that happens to already exist in the repo.

#### Scenario: An unrelated ticket lands for the same project

- **WHEN** ticket `ACME-42` has an existing mirrored artifact and an unrelated ticket `ACME-51` for the same project lands without touching `.weave/artifacts/ACME-42/**`
- **THEN** `ACME-42`'s artifact record is unchanged by `ACME-51`'s landing
