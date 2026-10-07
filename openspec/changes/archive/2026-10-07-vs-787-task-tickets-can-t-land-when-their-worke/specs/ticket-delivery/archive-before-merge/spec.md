## ADDED Requirements

### Requirement: A task ticket whose bound change does not exist lands with the archive skipped
When the daemon lands a ticket of kind `task` and the ticket's bound OpenSpec change exists neither under `openspec/changes/` nor in the archive of the ticket's branch, it SHALL skip archiving, merge normally, and record a status comment on the ticket saying that no OpenSpec change existed and the archive was skipped. A `task` ticket whose change exists SHALL be archived as before. A ticket of kind `change` whose bound change does not exist SHALL still fail the landing with `openspec_archive_blocked`.

#### Scenario: Task ticket with no change directory
- **WHEN** landing is requested for a `task` ticket whose bound change has no directory on its branch
- **THEN** the pull request is merged without an archive commit and the ticket carries a comment that no OpenSpec change existed and the archive was skipped

#### Scenario: Task ticket with a change
- **WHEN** landing is requested for a `task` ticket whose bound change directory exists
- **THEN** the change is archived onto the branch before the merge, as for any ticket

#### Scenario: Change ticket with a missing change
- **WHEN** landing is requested for a `change` ticket whose bound change does not exist
- **THEN** landing fails with `openspec_archive_blocked` and nothing is merged
