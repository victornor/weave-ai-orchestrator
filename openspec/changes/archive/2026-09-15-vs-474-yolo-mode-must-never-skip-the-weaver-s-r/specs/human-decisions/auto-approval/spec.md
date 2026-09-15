## ADDED Requirements

### Requirement: No auto-approval path answers at raise time

Every path that grants a plan or merge approval under YOLO mode SHALL leave the card open and
**not looked at yet** when it is raised, so the weaver's creation-time review wake has a live card to
review. No path SHALL answer an approval as the `system` actor at the instant it is created.

This applies to each of the daemon's auto-approve paths: the plan approval raised at a `change`
ticket's `proposed` transition, the plan approval a repair pass re-raises for a stranded ticket, the
fresh plan approval published at the end of a worker's turn when a revised plan is republished, the
merge approval raised when a ticket enters `in_review`, and the archive-backfill merge approval raised
for a finished ticket's left-behind OpenSpec change.

Once the weaver marks such a card **looked at**, the daemon SHALL grant it promptly: a plan approval
immediately on the mark; an archive-backfill merge approval immediately on the mark; an ordinary
merge approval on the next auto-merge sweep, subject to the same readiness condition ("A merge
approval is granted when the work is ready to land") and the same merge flow. A card marked **looked
at, with concerns** SHALL keep holding until it is superseded by a new revision whose fresh card is
then marked **looked at**.

#### Scenario: A plan raised at the `proposed` transition stays unseen

- **WHEN** a `change` ticket's plan validates, the mode is on for its project, and the ticket transitions to `proposed`
- **THEN** the plan approval is raised and left open and **not looked at yet**, and the ticket does not move to `approved` until it is marked looked at

#### Scenario: A merge raised at `in_review` stays unseen

- **WHEN** a ticket enters `in_review` under the mode and raises its merge approval
- **THEN** the approval is open and **not looked at yet**, and it is not granted while it is unseen

#### Scenario: A repaired plan approval stays unseen

- **WHEN** the repair pass raises a fresh plan approval for a stranded ticket whose project runs under the mode
- **THEN** the approval is open and **not looked at yet**, and it is not granted until it is marked looked at

#### Scenario: A republished plan approval stays unseen

- **WHEN** a worker revises a plan while the ticket is still `proposed` and the daemon publishes a fresh plan approval at the end of that turn
- **THEN** the fresh approval is open and **not looked at yet**, and it is not granted until it is marked looked at

#### Scenario: An archive-backfill merge approval stays unseen

- **WHEN** the daemon raises a merge approval for a finished ticket's archive-backfill pull request under the mode
- **THEN** the approval is open and **not looked at yet**, and the archive pull request is not merged until it is marked looked at

#### Scenario: A looked plan is granted immediately

- **WHEN** the weaver marks an open YOLO plan approval **looked at** with its note
- **THEN** the daemon grants it as the `system` actor in the same interaction, and the ticket proceeds to implementation

#### Scenario: A looked archive-backfill merge is granted on the mark

- **WHEN** the weaver marks an open YOLO archive-backfill merge approval **looked at** with its note
- **THEN** the daemon grants it as the `system` actor, and the archive pull request is landed through the archive landing path

#### Scenario: A looked ordinary merge waits for the sweep and the checks

- **WHEN** the weaver marks an open YOLO merge approval **looked at** but its pull request's checks have not passed
- **THEN** the approval stays open, and the next auto-merge sweep grants it only once the checks pass

#### Scenario: A concern keeps holding

- **WHEN** the weaver marks an open YOLO plan or merge approval **looked at, with concerns**
- **THEN** the approving answer is refused, the card stays open, and it is granted only after a new revision raises a fresh card that is marked looked at

### Requirement: YOLO grants only the kinds that carry review, and never bypasses CI

The hold this change adds SHALL apply only to the decision kinds that carry the weaver's review —
`plan_approval` and `merge_approval` among the auto-approved ones. A `hire_approval`,
`discard_approval`, `retry_approval`, `action_approval`, `gate_finding`, `question` or `concern` does
not carry a review state, is not auto-approved, and SHALL be unaffected.

Removing the `system`-actor exemption SHALL NOT change any other system answer. The system actor only
ever answers the plan and merge approvals this specification covers.

A YOLO grant SHALL NOT bypass the CI readiness gate: a merge approval SHALL be granted only once the
project's readiness condition for landing is met, exactly as it is for a human's approval.

#### Scenario: An action approval is not granted by the mode

- **WHEN** an `action_approval` is raised under the mode
- **THEN** it waits for the human and is not granted by the daemon

#### Scenario: An unseen merge with failing checks is not granted

- **WHEN** the weaver marks a YOLO merge approval looked at and the pull request's checks have failed
- **THEN** the approval stays open, is not granted, and the ticket records that the auto-approval is waiting on failing checks

### Requirement: A YOLO merge approval is granted only for the head the weaver reviewed

A `looked` mark on a `merge_approval` SHALL record the head the review was made against. A grant of a
`merge_approval` under the mode SHALL require that the recorded head equal the head the daemon is
about to land — the card's pull request head, or, for an archive-backfill card, the archive pull
request's head rather than the finished ticket's own pull request. When the recorded head is absent,
or differs from the head about to be landed, the card SHALL be treated as unreviewed: the daemon SHALL
NOT grant it, and the auto-merge sweep SHALL record "auto-merge is waiting: the weaver has not
reviewed the current head yet" once per head, through the same once-per-reason recording it uses for
its other waits. The card becomes grantable again once the weaver marks it looked at against the new
head.

The guard SHALL apply to the daemon's own grant only: a human's approving answer keeps the behaviour
it has today, whatever the review head is. A `plan_approval` SHALL require no equivalent guard,
because a revised plan raises a fresh approval that starts **not looked at yet**.

#### Scenario: The reviewed head is the head to land

- **WHEN** a YOLO merge card is marked looked at, the recorded head equals the pull request's current head, and its checks have passed
- **THEN** the sweep grants the approval and the ticket enters the merge flow

#### Scenario: A push after the mark prevents the grant

- **WHEN** a YOLO merge card is marked looked at head A, a worker then pushes head B, and the checks are green
- **THEN** the sweep does not grant the approval, records once that auto-merge is waiting because the current head has not been reviewed, and the ticket stays `in_review`

#### Scenario: A second look at the new head grants

- **WHEN** the card held at head B is marked looked at again with head B recorded
- **THEN** the next sweep grants the approval

#### Scenario: A plan revision needs no head check

- **WHEN** a plan approval is held with concerns and the worker publishes a new revision
- **THEN** the fresh plan approval starts **not looked at yet**, so a grant can only be for the revision the weaver marks

#### Scenario: A human answer is unaffected by the head check

- **WHEN** a human answers an open YOLO merge card approve while the recorded review head differs from the pull request head
- **THEN** the answer is recorded exactly as it would be without this requirement

## MODIFIED Requirements

### Requirement: A plan approval is granted when the plan validates

While the mode is on for a ticket, the plan approval that a `change` ticket raises when its plan is
complete and validates SHALL be raised exactly as it is when the mode is off, and SHALL then wait
until the weaver has reviewed it before being granted by the daemon. The ticket SHALL proceed to
implementation by the same path a human approval puts it on, including waking the worker.

The mode SHALL NOT change when the approval is raised, what it is raised for, or what happens after
it is granted. In particular it SHALL NOT cause a plan that does not validate to be approved.

The approval SHALL be granted only once its review state is **looked at**. While it is **not looked at
yet** or **looked at, with concerns** it SHALL remain open, exactly as a human-owned card would.

#### Scenario: A plan validates while the mode is on

- **WHEN** a `change` ticket's plan is complete and validates, the mode is on for that ticket, and the plan approval has been marked looked at
- **THEN** the approval is granted, and the ticket moves on to implementation

#### Scenario: An unreviewed plan is not granted

- **WHEN** a `change` ticket's plan is complete and validates and the mode is on, but the plan approval has not been reviewed
- **THEN** the approval stays open and **not looked at yet**, and the ticket does not move on

#### Scenario: A plan does not validate

- **WHEN** a `change` ticket's plan is incomplete or fails validation and the mode is on
- **THEN** no approval is raised and no approval is granted; the ticket is not moved on

#### Scenario: The mode is off

- **WHEN** a `change` ticket's plan validates and the mode is off for that ticket
- **THEN** the plan approval is raised and waits for the human, as it does without this feature

### Requirement: A merge approval is granted when the work is ready to land

While the mode is on for a ticket, the merge approval raised when the worker delivers SHALL be
raised exactly as it is when the mode is off, and SHALL then wait until the weaver has reviewed it
and until the delivered work is ready to land before being granted by the daemon. Work is ready to
land when the ticket's delivery is complete and the project's own readiness condition for landing is
met — for a pull-request delivery whose project requires CI, that the pull request exists and its
checks have passed.

While the work is not yet ready, or the card has not been reviewed, the approval SHALL remain open
and SHALL NOT be granted. Checks that have failed SHALL NOT be treated as ready, and the ticket SHALL
be told so rather than left silent.

Once granted, the ticket SHALL land by the same path a human approval puts it on, including taking
its place in the project's merge queue and the verification that the branch actually landed. The
mode SHALL NOT bypass either.

The approval SHALL be granted only once its review state is **looked at**. While it is **not looked at
yet** or **looked at, with concerns** it SHALL remain open, exactly as a human-owned card would.

#### Scenario: Checks pass

- **WHEN** a ticket's merge approval is open, the mode is on, the card has been marked looked at, and the delivered pull request's checks have passed
- **THEN** the approval is granted and the ticket enters the merge flow through the merge queue

#### Scenario: Checks are still running

- **WHEN** a ticket's merge approval is open, the mode is on, and the delivered pull request's checks have not finished
- **THEN** the approval stays open and is not granted

#### Scenario: Checks have failed

- **WHEN** a ticket's merge approval is open, the mode is on, and the delivered pull request's checks have failed
- **THEN** the approval stays open, is not granted, and the ticket records that the auto-approval is waiting on failing checks

#### Scenario: The card has not been reviewed

- **WHEN** a ticket's merge approval is open, the mode is on, the checks have passed, and the card is still **not looked at yet**
- **THEN** the approval stays open, is not granted, and the ticket records that the auto-approval is waiting for the weaver's review

#### Scenario: The project does not require checks

- **WHEN** a ticket's merge approval is open, the mode is on, the card has been marked looked at, and the project does not require checks before landing
- **THEN** the approval is granted without waiting for any check result

#### Scenario: The mode is off

- **WHEN** a ticket's merge approval is open and the mode is off for that ticket
- **THEN** the approval waits for the human however green the checks are

### Requirement: The mode is unmistakable wherever an approval would have been

Because the mode is set per project, no workspace-wide indicator SHALL claim it is on for the whole
workspace. Each project with the mode on SHALL show a visible marker where the project is shown:
in its row in Settings → Projects and in the project's overview header.

Once the weaver has marked a decision the daemon will grant **looked at**, that decision SHALL NOT be
presented to the human as something to approve: wherever an approve action would otherwise be offered
for it, the surface SHALL instead say the decision is auto-approved under this mode, and SHALL offer
no approve action for it. A ticket whose only open decision is one the daemon will grant after review
SHALL NOT be presented as waiting on the human.

A decision the daemon will grant that is still **not looked at yet** SHALL instead present as waiting
on the weaver's review, per "An unreviewed approval states plainly that it is waiting on the weaver's
review", and SHALL NOT be presented as auto-approved yet or as waiting on the human.

Decisions the mode does not cover SHALL be presented exactly as they are without it.

#### Scenario: The indicator

- **WHEN** a project has the mode on
- **THEN** its row in Settings → Projects and its overview header each show a marker saying so, and no workspace-wide indicator claims the mode is on for every project

#### Scenario: A merge approval that will be granted

- **WHEN** an open merge approval the daemon will grant has been marked looked at and is shown to the human
- **THEN** the card says it is auto-approved under this mode and offers no approve action

#### Scenario: An unreviewed merge approval that will be granted

- **WHEN** an open merge approval the daemon will grant is still **not looked at yet** and is shown to the human
- **THEN** the card presents as waiting on the weaver's review and offers no approve action

#### Scenario: A ticket waiting only on an auto-approval

- **WHEN** a ticket's only open decision is one the daemon will grant after review
- **THEN** the board does not mark it as waiting on the human

#### Scenario: A decision the mode does not cover

- **WHEN** a hire approval or a question is shown to the human while the mode is on for the project
- **THEN** it is presented with its usual actions, unchanged
