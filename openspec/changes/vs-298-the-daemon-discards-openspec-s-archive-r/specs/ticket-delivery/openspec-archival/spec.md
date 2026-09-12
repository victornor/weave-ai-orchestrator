## MODIFIED Requirements

### Requirement: An archive failure carries the validator's own reason

When the daemon's attempt to archive a ticket's OpenSpec change fails, the recorded reason SHALL
include the actual validation or archive error the `openspec` CLI reported, not merely the command's
exit status. When that error includes guidance on how to resolve it, distinct from the headline
description of what failed, the recorded reason SHALL include that guidance as well.

The failure SHALL be recorded under an error code that distinguishes a refusal `openspec` itself
explained from an attempt that produced no such explanation. The generic, unactionable code used for
an unclassified failure SHALL NOT be used when `openspec` returned a structured reason for refusing.

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

#### Scenario: A refusal's guidance is not dropped

- **WHEN** `openspec` refuses to archive a change because a capability's rebuilt spec would hold
  content the merge cannot safely account for, and its structured output carries both a headline
  description of the failure and separate guidance on how to resolve it
- **THEN** the recorded failure includes that guidance verbatim, not only the headline description

#### Scenario: A refusal openspec explains is not reported as an unclassified failure

- **WHEN** `openspec`'s archive command refuses with a structured, named reason
- **THEN** the failure recorded on the ticket carries an error code distinct from the code used when
  the archive attempt produced no structured reason at all
