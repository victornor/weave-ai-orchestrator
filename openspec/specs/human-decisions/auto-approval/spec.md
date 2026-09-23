# human-decisions/auto-approval Specification

## Purpose
Defines YOLO mode: the setting that lets a workspace, or one project inside it, have its plan
approvals and merge approvals granted by the daemon instead of by the human — when each approval is
granted, how it is recorded so the history still says who approved what, which decisions the mode
must never touch, and how every surface that would otherwise offer an approve action reads while it
is on.

## Requirements

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

### Requirement: An auto-approval is recorded as the daemon's, naming the mode

An approval granted under this mode SHALL be recorded against the same decision the human would have
answered, as answered by the system rather than by a human, and its recorded answer SHALL name YOLO
mode and the project whose setting granted it as the reason it was granted.

Everything that follows an answer SHALL follow an auto-approval too: the decision is no longer open,
the agent that asked is woken with the answer, and the history shows the decision and its answer
where an approval given by the human would appear.

#### Scenario: The record of a granted plan approval

- **WHEN** a plan approval has been granted under this mode
- **THEN** the decision reads as answered by the system, with an answer that names YOLO mode, and it is no longer waiting

#### Scenario: The record of a granted merge approval

- **WHEN** a merge approval has been granted under this mode
- **THEN** the decision reads as answered by the system, with an answer that names YOLO mode, and it is no longer waiting

#### Scenario: The asker is told

- **WHEN** an approval raised by a worker is granted under this mode
- **THEN** that worker is woken with the answer exactly as it is when the human answers

### Requirement: No other decision is auto-approved

The mode SHALL apply to plan approvals and merge approvals only. Hire approvals, worktree discard
approvals, worker retry approvals, operational action approvals, gate findings and questions put to
the human SHALL keep their owners and SHALL still wait to be answered, whatever the mode is set to.

#### Scenario: A hire, a discard or a retry

- **WHEN** a hire approval, a discard approval or a retry approval is raised while the mode is on
- **THEN** it waits for the human and is not granted by the daemon

#### Scenario: A question

- **WHEN** an agent asks the human a question while the mode is on
- **THEN** the question waits for an answer and is not answered by the daemon

#### Scenario: An action approval

- **WHEN** an `action_approval` is raised on an `operational` ticket while the mode is on
- **THEN** it waits for the human and is not granted by the daemon

### Requirement: Turning the mode off stops what has not happened yet

Whether an approval is granted by the daemon SHALL be decided from the setting as it stands at the
moment the approval would be granted, not as it stood when the decision was raised.

Turning the mode off SHALL therefore stop the daemon granting any approval it has not already
granted, including one whose decision is already open and waiting. An approval that has already been
granted SHALL NOT be reversed, and a ticket already past that approval SHALL NOT be sent back.

#### Scenario: Turned off while a merge approval waits

- **WHEN** the mode is turned off while a merge approval that would have been auto-approved is still open
- **THEN** that approval is not granted by the daemon and waits for the human

#### Scenario: Turned off after an approval was granted

- **WHEN** the mode is turned off after an approval has already been granted under it
- **THEN** that approval stands, and the ticket continues from where the approval put it

#### Scenario: Turned on while a merge approval waits

- **WHEN** the mode is turned on while a merge approval is open and its work is ready to land
- **THEN** that approval is granted by the daemon

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

### Requirement: Agents are told the policy in force

The instructions the conductor works from and the brief a worker works from SHALL state whether
approvals are granted by the daemon for the work in hand, so that neither asks the human to approve
something that will be approved without them, and neither waits on a human who will never be asked.

#### Scenario: The conductor is told

- **WHEN** the conductor's instructions are built while the mode is on
- **THEN** they state that plan and merge approvals are granted automatically

#### Scenario: A worker is told

- **WHEN** a worker's brief is built for a ticket whose project has the mode on
- **THEN** it states that the plan and merge approvals for that ticket are granted automatically

#### Scenario: The mode is off

- **WHEN** the instructions or a brief are built while the mode is off for the work in hand
- **THEN** they state that those approvals wait for the human

### Requirement: YOLO mode is a per-project setting

YOLO mode SHALL be set on a project and SHALL be off for a project that has not set it. There SHALL
be no workspace-wide YOLO setting, and no project SHALL inherit the mode from the workspace. A
project added after this change SHALL start with the mode off.

Whether the mode is on for a given ticket SHALL be determined solely by that ticket's project. That
project SHALL be read from the ticket's own project when it is set, and otherwise from the project of
the role the ticket is assigned to, so a ticket that names a project either way is never treated as
project-less. Only a ticket that names no project — neither its own nor through an assignee role —
SHALL be treated as having no project, and the mode off for it.

The setting SHALL be readable and writable from the web app and from the CLI, and the value the
daemon acts on SHALL be the value those surfaces show.

#### Scenario: Off for a project that has not set it

- **WHEN** neither a project nor anything above it sets the mode
- **THEN** the mode is off for that project and every approval is put to the human exactly as it is without this feature

#### Scenario: A new project starts off

- **WHEN** a project is added while other projects have the mode on
- **THEN** the new project has the mode off

#### Scenario: A ticket with no project

- **WHEN** a ticket names no project, neither its own project nor through an assignee role
- **THEN** the mode is off for it, whatever any project's setting is

#### Scenario: A project-less row assigned to a role resolves its project

- **WHEN** a ticket's own project is null but it is assigned to a project-scoped role whose project has the mode on
- **THEN** the mode is treated as on for that ticket, and its plan and merge approvals are granted exactly as they are for a ticket that carries the project itself

#### Scenario: Changed from either surface

- **WHEN** the human turns the mode on or off for a project from the web app or from the CLI
- **THEN** that project's setting changes and both surfaces then report the new value

### Requirement: A workspace's former default is migrated to its projects once

When a workspace is loaded and its stored config still carries `defaults.yolo: true`, the daemon
SHALL copy that value onto every existing project that has not set `policies.yolo` itself, SHALL
leave a project that explicitly set `policies.yolo: false` unchanged, and SHALL record in the log
how many projects it changed. The migration SHALL run once per workspace; on the next load it SHALL
do nothing. After it has run, `defaults.yolo` SHALL grant nothing, and a project added later SHALL
not receive it.

The workspace's stored `defaults.yolo` SHALL be dropped when the migration writes the config back.
Writing the key again SHALL be refused with an error naming the per-project setting as its
replacement. Reading a workspace that still carries the key SHALL never fail.

#### Scenario: A workspace with the old default on

- **WHEN** a workspace whose config has `defaults.yolo: true` and two projects with no `policies.yolo` is loaded for the first time after this change
- **THEN** both projects are stored with `policies.yolo: true`, the change is logged, and both remain in YOLO mode exactly as before

#### Scenario: An explicit project opt-out is preserved

- **WHEN** that workspace also has a project whose `policies.yolo` is explicitly `false`
- **THEN** the migration leaves that project off

#### Scenario: The migration runs once

- **WHEN** the same workspace is loaded again
- **THEN** the migration does nothing and the projects keep the values it wrote

#### Scenario: A newly added project is not affected

- **WHEN** a project is added after the migration has run
- **THEN** it starts with the mode off even though the old workspace default was on

#### Scenario: Writing the deprecated workspace key is refused

- **WHEN** `defaults.yolo` is written through the CLI or the config API
- **THEN** the write is refused with an error naming the per-project setting as its replacement, and no other workspace setting is changed

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

### Requirement: A reviewed auto-approval that did not resolve is caught and surfaced

The daemon SHALL periodically scan, on the same cadence as the auto-merge sweep, for open
`plan_approval` and `merge_approval` decisions that carry the weaver's review (`looked at` or
`looked at, with concerns`) and have been open for longer than a short threshold, on a project where
the mode is on.

A reviewed card the daemon should have granted, but has not, SHALL be granted by the scan where the
card has no other periodic path to a grant — a `plan_approval`, or a `merge_approval` for an
archive-backfill pull request. An ordinary `merge_approval` SHALL continue to be granted by the
auto-merge sweep, subject to its readiness condition.

Any scanned card still unresolved after the threshold SHALL be surfaced once: a system comment on its
ticket naming the card, its review state and the elapsed time, and a wake to the weaver, so that a
reviewed card can no longer sit silently for hours. The surface SHALL be recorded once per card and
SHALL NOT repeat on every scan.

This scan SHALL NOT alter the readiness condition, the review requirement or the reviewed-head guard:
it grants only what the mark path and the auto-merge sweep would already have granted, and it never
grants a card the mode does not cover.

#### Scenario: A missed plan grant is recovered

- **WHEN** a YOLO project's plan approval has been marked looked at but is still open after the threshold
- **THEN** the scan grants it as the `system` actor and the ticket proceeds to implementation, exactly as the mark path would have

#### Scenario: A stale reviewed merge card is surfaced

- **WHEN** a YOLO ticket's `merge_approval` has been marked looked at and is still open after the threshold
- **THEN** the ticket records a system comment naming the card and the time since it was reviewed, and the weaver is woken once about it

#### Scenario: A held card is not granted by the scan

- **WHEN** a reviewed merge card is still open because its reviewed head moved, or because the weaver marked concerns
- **THEN** the scan does not grant it, and the existing hold and re-review behaviour is unchanged

#### Scenario: The surface does not repeat

- **WHEN** the scan runs again over a card it has already surfaced and the card is still open
- **THEN** it records no second comment and wakes no one again for that card

#### Scenario: The mode is off

- **WHEN** a reviewed card's project does not have the mode on
- **THEN** the scan leaves it exactly as it is, waiting for the human

#### Scenario: An unreviewed card is untouched

- **WHEN** an open plan or merge approval has not been marked by the weaver
- **THEN** the scan does not grant it and does not surface it as stale
