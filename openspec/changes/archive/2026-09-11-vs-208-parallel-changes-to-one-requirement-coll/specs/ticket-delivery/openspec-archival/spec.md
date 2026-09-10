## Purpose

Defines what happens when the daemon tries to archive a ticket's OpenSpec change after its work
has landed: a failure is never silent, and the attempt is retried for every ticket kind that can
own a change, not only `change` tickets — so a validation collision between two parallel changes to
the same requirement is always legible, and a change a merged ticket left behind is always
eventually archived without a human or an agent having to notice and repair it by hand.

## ADDED Requirements

### Requirement: An archive failure carries the validator's own reason

When the daemon's attempt to archive a ticket's OpenSpec change fails, the recorded reason SHALL
include the actual validation or archive error the `openspec` CLI reported, not merely the command's
exit status.

#### Scenario: A MODIFIED requirement would drop another change's scenarios

- **WHEN** archiving a ticket's change would drop a scenario present in the current spec because a
  MODIFIED requirement in the change's delta predates another, already-archived change to the same
  requirement
- **THEN** the failure recorded on the ticket names the requirement and the dropped scenario(s), in
  the same terms `openspec validate --strict` would report

#### Scenario: The underlying command reports nothing on its error stream

- **WHEN** the `openspec` CLI's archive command exits non-zero and writes its failure detail to its
  structured output rather than its error stream
- **THEN** the recorded failure still carries that detail, not an empty or placeholder message

### Requirement: Archive backfill covers every ticket kind that can own a change

The reconciliation sweep that archives an OpenSpec change left behind by a finished ticket SHALL
consider every finished ticket that recorded an OpenSpec change, regardless of the ticket's kind.

#### Scenario: A task ticket's tracker change is left behind

- **WHEN** a `task` ticket carrying an OpenSpec tracker change (`skip_specs: true`) finishes without
  its change being archived
- **THEN** the next reconciliation sweep archives that change on the same terms as a `change`
  ticket's

#### Scenario: A ticket with no change is never considered

- **WHEN** a finished ticket recorded no OpenSpec change
- **THEN** the reconciliation sweep does not attempt to archive anything for it

### Requirement: A reconciliation archive failure is recorded, not only logged

When the reconciliation sweep's own attempt to archive a left-behind change fails, the ticket SHALL
receive a record of that failure and the conductor SHALL be notified, on the same terms a failure
at merge time already is — but at most once per ticket for a standing failure, so a change that
keeps failing every sweep does not renotify on every pass.

#### Scenario: A left-behind change still fails to archive

- **WHEN** the reconciliation sweep's archive attempt for a left-behind change fails
- **THEN** the ticket carries a comment naming the failure and the conductor is woken

#### Scenario: The same failure persists across sweeps

- **WHEN** a ticket's change fails to archive on a later sweep for the same standing reason
- **THEN** the conductor is not woken again for a failure it was already notified of
