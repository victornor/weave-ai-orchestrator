## Purpose

Defines what counts as a "no progress" turn for the stuck-worker `gate_finding` — the escalation
that tells the conductor a worker may need steering, a relaunch, or its ticket cancelled — so the
finding fires only for a worker that is actually stuck, never for one that acted but reported badly,
or one correctly waiting on someone else.

## ADDED Requirements

### Requirement: A validly-reported idle turn is recorded distinctly from a turn with no report

A turn whose terminal report states `idle` SHALL be recorded with its own liveness value, distinct
from the value recorded when a run's report is missing or fails to parse. Nothing about what makes a
report valid or invalid changes: a report that fails to parse — including one that skips the required
knowledge decision — is unaffected by this requirement and keeps the liveness value it has today.

#### Scenario: An idle report is not recorded as no report

- **WHEN** a turn's terminal report validly states `idle`
- **THEN** the run's liveness is recorded as `idle`, not as the value used for a missing or unparseable report

#### Scenario: A report that fails to parse is unaffected

- **WHEN** a turn's terminal report is missing, or fails to parse for any reason including an omitted
  knowledge decision
- **THEN** the run's liveness is recorded exactly as it is today

### Requirement: The stuck-worker gate counts only turns with no observable evidence of progress

Before counting a run toward the stuck-worker gate, the system SHALL check whether that run produced
observable evidence of progress on its ticket: a ticket comment, a ticket document revision, a ticket
work product, or a knowledge revision authored under that run's id, or the ticket's status having
changed between the start and the end of the run. A run that produced any such evidence SHALL NOT be
counted toward the gate, regardless of whether its own terminal report parsed.

A run that produced no such evidence, and whose terminal report was missing, unparseable, or validly
`idle`, SHALL be counted toward the gate exactly as a run with no report is counted today.

#### Scenario: A delivered turn is not counted, whatever its own report says

- **WHEN** a run posts a ticket comment, opens a work product, writes a ticket document, or records
  knowledge, and its own terminal report is missing or fails to parse
- **THEN** that run is not counted toward the stuck-worker gate

#### Scenario: A turn with no evidence and no valid report is counted

- **WHEN** a run produces none of a ticket comment, a document revision, a work product, or a
  knowledge revision authored under it, its ticket's status is unchanged by the run, and its terminal
  report is missing, unparseable, or `idle`
- **THEN** that run is counted toward the stuck-worker gate on the same terms as today

#### Scenario: Three genuinely inert turns still raise the finding

- **WHEN** three consecutive turns by the same worker each meet the conditions of the previous
  scenario
- **THEN** the stuck-worker `gate_finding` is raised for the conductor, exactly as it is today

### Requirement: A worker correctly waiting on someone else does not accumulate toward the gate

A run finishing while its ticket is in a status where the worker is not expected to act on its own —
`proposed`, `in_review`, or `blocked` — SHALL NOT be counted toward the stuck-worker gate, whatever its
liveness or evidence.

#### Scenario: Idle turns while awaiting a merge approval do not trip the gate

- **WHEN** a worker's ticket is `in_review` awaiting a human's merge decision, and the worker reports
  `idle` on each of three consecutive turns woken by unrelated ticket activity
- **THEN** no stuck-worker `gate_finding` is raised for those turns

#### Scenario: The same worker still trips the gate once expected to act

- **WHEN** that worker's ticket moves to a status where it is expected to act, and it then produces
  three consecutive turns with no evidence and no valid report
- **THEN** the stuck-worker `gate_finding` is raised, counting only turns from that point
