## ADDED Requirements

### Requirement: merge-done never claims a merge for a project-less ticket with a pull request to land

When merge-done is called for a ticket whose `project_id` is null and that ticket has a
pull-request work product recorded, merge-done SHALL throw an error rather than completing the
ticket as `done`, and SHALL NOT write `merged: true` on the ticket's delivery. The ticket SHALL
remain `merging`. Merge-done SHALL still complete a project-less ticket that has no pull-request
work product to land, exactly as before.

#### Scenario: A project-less ticket with an open pull request is refused

- **WHEN** merge-done is called for a ticket whose `project_id` is null and that has a
  pull-request work product recorded
- **THEN** merge-done throws, the ticket stays `merging`, and its delivery does not claim `merged: true`

#### Scenario: A project-less ticket with nothing to land still completes

- **WHEN** merge-done is called for a ticket whose `project_id` is null and that has no
  pull-request work product recorded
- **THEN** merge-done completes the ticket as `done`, as it did before this change

### Requirement: A finished ticket's false merge claim self-heals once the forge confirms it

The daemon's periodic reconciliation SHALL check, for each `done` ticket whose delivery has
`merged` true with no `mergeCommit` and names a pull-request URL, that pull request's current
state on the forge. When the forge reports it merged, the daemon SHALL correct that ticket's
delivery record with the forge's merge commit, without changing the ticket's status or triggering
any other post-merge follow-up. When the forge does not report it merged, the daemon SHALL leave
the record unchanged.

#### Scenario: A pull request merged after the fact corrects the record

- **WHEN** reconciliation finds a `done` ticket whose delivery claims `merged: true` with no
  `mergeCommit`, and the forge now reports that ticket's pull request as merged
- **THEN** the ticket's delivery is updated with the real merge commit, and the ticket's status
  and other delivery fields are otherwise left as they were

#### Scenario: A pull request still open is left alone

- **WHEN** reconciliation finds the same shape of incomplete delivery, but the forge reports the
  pull request as still open or closed without merging
- **THEN** the ticket's delivery record is not changed
