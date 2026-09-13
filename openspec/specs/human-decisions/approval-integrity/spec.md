# human-decisions/approval-integrity Specification

## Purpose
Keeps an approval honest: the daemon reserves the `plan` document key so a worker's plan write can
never silently supersede the plan approval it was awaiting, and an approval cannot sit open on a
card whose decision no longer accepts its action or whose ticket has reached a terminal status.

## Requirements

### Requirement: The `plan` document key is reserved to the daemon

A ticket's `plan` document SHALL only ever be written by the daemon itself — the generated
proposal-and-tasks digest a `plan_approval` decision targets. A write to the `plan` key from any
other caller, human or agent, through the agent tool or the HTTP API, SHALL be refused with a clear
error naming `report` (or another key) as the place for the caller's own notes, and SHALL NOT create
a document revision or affect any decision.

Refusing an external write to `plan` SHALL NOT affect reading it: `ac_ticket_document_get` and the
equivalent HTTP route SHALL keep returning every existing and future `plan` revision exactly as
before.

#### Scenario: A worker tries to write its own notes as `plan`

- **WHEN** a worker calls `ac_ticket_document_put` with `key: "plan"` on its own ticket
- **THEN** the write is refused, no new `plan` revision is created, and the error names `report` as
  where the note belongs

#### Scenario: The daemon's own plan digest still writes

- **WHEN** a `change` ticket's OpenSpec validation passes and the ticket transitions to `proposed`
- **THEN** the daemon writes the rendered proposal-and-tasks digest to the ticket's `plan` document,
  exactly as before

#### Scenario: A genuine plan revision still supersedes a stale approval

- **WHEN** a `change` ticket returns to `proposing` after a `revise` answer, is fixed, and reaches
  `proposed` again
- **THEN** the daemon's new `plan` revision supersedes any plan approval still open under the same
  ticket, and the newly created plan approval targets the new revision

#### Scenario: Reading a `plan` document is unaffected

- **WHEN** any caller reads a ticket's `plan` document, at its current revision or an earlier one
- **THEN** the read succeeds exactly as it would have before this requirement existed

### Requirement: A ticket cannot sit indefinitely on an approval that does not exist

A `change` ticket in `proposed`, and any ticket in `in_review` that does not carry `auto_merge`,
SHALL always have an open decision it is waiting on. Whatever the cause of a gap — a document write
that closed the decision, a withdrawal, a bug not yet known — the daemon SHALL detect a ticket in one
of these statuses with no matching open decision and raise a fresh one for it, on the same cadence as
its liveness scan, so the ticket is never left silently stranded on an approval nobody can answer.

A freshly raised approval SHALL behave exactly as an original one would: a `plan_approval` raised
this way SHALL be auto-answered immediately when the ticket's project runs under YOLO mode, exactly
as the approval created at the `proposed` transition would have been; a `merge_approval` raised this
way SHALL be picked up and, under YOLO or `auto_merge`, answered by the existing auto-merge sweep on
its own next pass, the same as a normally-created one.

#### Scenario: A `proposed` ticket with no open plan approval is repaired

- **WHEN** a `change` ticket is `proposed` and has no open `plan_approval` decision
- **THEN** the daemon raises a fresh `plan_approval` decision for it before the next liveness-scan
  interval has passed twice

#### Scenario: An `in_review` ticket with no open merge approval is repaired

- **WHEN** a ticket is `in_review`, does not carry `auto_merge`, and has no open `merge_approval`
  decision
- **THEN** the daemon raises a fresh `merge_approval` decision for it before the next liveness-scan
  interval has passed twice

#### Scenario: An `auto_merge` ticket in `in_review` is not touched

- **WHEN** a ticket is `in_review` and carries `auto_merge`
- **THEN** the repair scan does not raise a merge approval for it, since none is expected while
  `auto_merge` is set

#### Scenario: A YOLO ticket's repaired plan approval is answered immediately

- **WHEN** the repair scan raises a plan approval for a ticket whose project runs under YOLO mode
- **THEN** the approval is answered automatically and the ticket proceeds to `approved`, without
  waiting for a human

### Requirement: The conductor is told when the daemon repairs a stranded approval

Each time the repair scan finds and fixes one or more tickets stranded on a missing approval, the
daemon SHALL wake the conductor once, naming every ticket it repaired and which kind of approval was
missing, so a ticket that waited on an approval that did not exist is visible as a fault rather than
a silent, ordinary wait.

#### Scenario: The conductor learns which tickets were repaired

- **WHEN** the repair scan raises fresh approvals for one or more tickets in the same pass
- **THEN** the conductor receives a single wake naming each repaired ticket and the kind of approval
  that was missing

#### Scenario: Nothing to repair wakes nobody

- **WHEN** the repair scan finds no ticket waiting on a missing approval
- **THEN** it makes no wake and leaves no trace beyond its own routine sweep

### Requirement: A decision card never offers an action its decision does not accept

Every button a decision card offers SHALL send a key that decision's own options actually contain. A
card SHALL NOT be shipped with a hard-coded action whose key is not one of the option keys the daemon
declares when it creates that kind of decision. This applies to every surface that renders a decision
as a card, including the TUI's `decisionToCard`, not only the web app's.

A merge-approval card SHALL offer no action to defer answering it; taking the card out of view without
answering is covered entirely by hiding it from the chat where hiding exists, and by simply not acting
on a pinned decision where it does not — either way the decision stays open and unanswered for later.

A discard-approval card's action that proceeds with the discard SHALL send the same key
`applyDiscardApproval` treats as approval.

#### Scenario: The merge-approval card offers no Hold action

- **WHEN** a merge-approval card is shown for an open decision
- **THEN** its only actions are approving the merge and requesting changes, and no action sends a key
  other than `approve` or `changes`

#### Scenario: The discard-approval card's discard action is answerable

- **WHEN** the human confirms and sends a discard-approval card's action to proceed
- **THEN** the decision is answered with the key its options declare for proceeding, and the ticket's
  worktree discard is applied exactly as answering that option through any other surface would apply it

#### Scenario: A hard-coded card action is checked against its decision's real options

- **WHEN** a decision kind's card is built with actions whose keys are written into the card rather
  than read from the decision at render time
- **THEN** a test fails if any of those keys is absent from the option keys that kind of decision is
  actually created with

#### Scenario: The TUI's merge-approval card offers no Hold action either

- **WHEN** `decisionToCard` renders a merge-approval decision for the TUI
- **THEN** its only options are approving the merge and requesting changes, and none of them sends a
  key other than `approve` or `changes`

#### Scenario: The TUI's hire-approval card answers with the decision's real keys

- **WHEN** `decisionToCard` renders a hire-approval decision for the TUI
- **THEN** its options send `approve` to hire and `reject` to decline, never any other key

#### Scenario: The TUI's discard-approval card answers with the decision's real keys

- **WHEN** `decisionToCard` renders a discard-approval decision for the TUI
- **THEN** its options send `approve` to proceed with the discard and `reject` to keep the worktree,
  never any other key

### Requirement: Acting on a decision that has already left `open` status explains what happened

An attempt to answer a decision that is not `open` SHALL be refused, and the refusal SHALL name what
happened to it in terms the human did not have to infer: that it was superseded by a newer decision,
that it was already answered, or that it expired. When the decision was superseded, the refusal SHALL
identify the decision that replaced it, so the surface presenting the error can offer a way to it.

This refusal SHALL NOT be applied to, nor treated as an answer of, any decision other than the one
named in the request — in particular, a stale answer sent for a superseded decision SHALL NOT be
forwarded to, or recorded against, the decision that superseded it. The human answered the thing they
read; nothing acts on their behalf against a decision they have not seen.

#### Scenario: A stale approve names the replacement

- **WHEN** a human answers a `plan_approval` decision that was superseded before the answer reached
  the server
- **THEN** the answer is refused, the refusal states that the plan changed, and it identifies the
  decision that replaced it

#### Scenario: A stale answer never lands on the replacement

- **WHEN** a human answers a decision that has been superseded
- **THEN** the decision that replaced it is unaffected — its status, and every field an answer would
  set, are exactly as they were before the stale answer was sent

#### Scenario: An already-answered decision explains itself

- **WHEN** a human answers a decision that was already answered by another surface or device
- **THEN** the refusal states that it was already answered, without implying anything about their own
  answer having taken effect

#### Scenario: An expired decision explains itself

- **WHEN** a human answers a decision that expired before the answer reached the server
- **THEN** the refusal states that it expired

### Requirement: An open decision closes when its ticket reaches a terminal status

When a ticket reaches `done` or `cancelled`, every decision still `open` on that ticket SHALL be
withdrawn, whatever kind of decision it is, so it stops asking its owner to act on a ticket that is
already finished. The withdrawal SHALL record why the decision closed without an answer, so it is
auditable later that no one refused or ignored it — its ticket simply finished first.

A decision that has already left `open` status by the time its ticket reaches a terminal status —
answered, expired, superseded, or already withdrawn — SHALL be left exactly as it is.

A decision that carries no `ticketId` — a role hire or retirement approval, a workspace-wide
question, or a runtime-wide notice — is not scoped to any ticket's lifecycle and SHALL NOT be
affected by any ticket reaching a terminal status.

This applies uniformly to every decision kind that can carry a ticket id — `plan_approval`,
`merge_approval`, `retry_approval`, `gate_finding`, `question`, `concern`, and `action_approval` —
since each one exists only to decide something about that specific ticket's own progress, and none
of them has anything left to decide once the ticket is done or cancelled.

#### Scenario: An open merge approval closes when its ticket is done

- **WHEN** a ticket carrying an open `merge_approval` decision reaches `done`
- **THEN** the decision's status becomes `withdrawn` and it no longer appears in a query for `open`
  decisions

#### Scenario: An open plan approval closes when its ticket is cancelled

- **WHEN** a ticket carrying an open `plan_approval` decision reaches `cancelled`
- **THEN** the decision's status becomes `withdrawn`

#### Scenario: An already-answered decision is left alone

- **WHEN** a ticket reaches `done` or `cancelled` and one of its decisions was already `answered`
- **THEN** that decision's status, answer and answered-at fields are unchanged

#### Scenario: A decision not tied to any ticket survives every ticket's terminal transition

- **WHEN** a `hire_approval` decision, which is tied to a role rather than a ticket, is open
- **THEN** no ticket reaching `done` or `cancelled` withdraws it

#### Scenario: An open action approval closes when its ticket is done

- **WHEN** an `operational` ticket carrying an open `action_approval` decision reaches `done`
- **THEN** the decision's status becomes `withdrawn`

### Requirement: An action document on an operational ticket raises an action approval

`action_approval` SHALL be a system-raised, human-owned decision kind. It SHALL NOT be constructable
through `ac_ask`. Its option keys SHALL be `approve`, `revise` and `reject` — the same closed set
`plan_approval` uses — so every surface that renders it as a named card sends only those keys.

Writing the `action` document key on an `operational` ticket SHALL raise (or, on a later revision,
supersede and re-raise) that decision, targeting the new revision. The `plan` document key SHALL
remain reserved to the daemon and SHALL NOT be used for this purpose.

An `operational` ticket SHALL be repaired on the same cadence as a stranded `proposed` plan
approval only when it has an `action` document and the current `action` revision has no
`action_approval` in `open` or `answered` that targets that revision. An answered `approve` or
`revise` is not a missing approval: the daemon SHALL NOT raise a fresh `action_approval` for that
revision, including across repeated repair sweeps. A genuinely lost approval — no `open` or
`answered` card targeting the current revision — SHALL still be repaired: the daemon raises a
fresh `action_approval` targeting that revision and wakes the conductor naming the ticket and the
missing kind. YOLO SHALL NOT auto-answer a repaired `action_approval`.

A later write of `action` (a new revision, including after `revise`) SHALL still raise a fresh
`action_approval` targeting the new revision.

#### Scenario: writing action raises the card

- **WHEN** a worker writes an `action` document on an `operational` ticket
- **THEN** an `action_approval` owned by the human is created with options `approve`, `revise` and
  `reject`, targeting that revision

#### Scenario: a later action revision supersedes

- **WHEN** the worker writes a new revision of `action` while an `action_approval` is still open
- **THEN** the previous decision is superseded and a new `action_approval` targets the new revision

#### Scenario: a stranded operational action is repaired

- **WHEN** an `operational` ticket has an `action` document and no `action_approval` in `open` or
  `answered` targeting that revision
- **THEN** the daemon raises a fresh `action_approval` for it before the next liveness-scan interval
  has passed twice
- **AND** the conductor is woken naming the ticket and `action_approval`
- **AND** YOLO mode does not answer the repaired decision

#### Scenario: ac_ask cannot construct it

- **WHEN** a worker calls `ac_ask` naming `action_approval`
- **THEN** the call is refused and no decision is created

#### Scenario: approving an action approval does not re-raise it

- **WHEN** an `action_approval` targeting the current `action` revision is answered `approve`
- **AND** the repair scan runs, including more than once
- **THEN** no new `action_approval` is created

#### Scenario: an answered revise is not treated as missing

- **WHEN** an `action_approval` targeting the current `action` revision is answered `revise` and the
  worker has not yet written a new `action` revision
- **AND** the repair scan runs
- **THEN** no new `action_approval` is created for that same revision

#### Scenario: a new action revision after revise still raises

- **WHEN** an `action_approval` has been answered `revise` and the worker writes a new revision of
  `action`
- **THEN** a fresh `action_approval` is raised targeting the new revision

### Requirement: An action-approval card offers approve, revise and reject

An `action_approval` card SHALL offer exactly the keys the daemon declares when it creates that
kind: `approve`, `revise` and `reject`. This applies to the web app's DecisionCard and to the TUI's
`decisionToCard`.

#### Scenario: the web card's keys

- **WHEN** an `action_approval` card is shown for an open decision
- **THEN** its only actions send `approve`, `revise` or `reject`

#### Scenario: the TUI card's keys

- **WHEN** `decisionToCard` renders an `action_approval` decision
- **THEN** its options send `approve`, `revise` or `reject`, never any other key

### Requirement: A decision created on a ticket that is already terminal is not attached to it

When a decision is created naming a ticket whose status is already terminal (`done` or `cancelled`),
the decision SHALL still be created and SHALL be answerable exactly as it would be otherwise, but it
SHALL NOT be attached to that ticket: its ticket reference SHALL be empty. A decision scoped to a
ticket exists to decide something about that ticket's live progress; a decision named at a ticket
that has already finished has no such progress left to decide, and an attachment to it can never be
closed by the terminal transition that has already happened.

The decision SHALL keep the project the terminal ticket belonged to, so it is still grouped with the
work it concerns, and the daemon SHALL record a warning naming the ticket and the decision kind so
the misattached ask is visible rather than silent.

The decision SHALL also keep the correlation-key bucket it would have had while attached, derived
from the ticket it named, so the detached decision neither supersedes nor is superseded by a
workspace-level decision of the same kind. Dropping a ticket's attachment SHALL NOT move the decision
into the shared no-ticket bucket, where it could silently close an unrelated open card.

A decision naming a ticket that is not terminal SHALL keep that ticket attachment, unchanged. A
decision naming no ticket is unaffected.

#### Scenario: A follow-up question asked seconds after its ticket finished

- **WHEN** a `question` is created naming a ticket that reached `done` moments earlier
- **THEN** the decision is created and is open and answerable
- **AND** its ticket reference is empty, so no future terminal transition is needed to close it
- **AND** it keeps the project the finished ticket belonged to
- **AND** it keeps its own correlation-key bucket, derived from the ticket it named

#### Scenario: A detached follow-up does not disturb a workspace-level question

- **WHEN** an open workspace-level `question` exists and a `question` is then created detached from a
  terminal ticket
- **THEN** the workspace-level question stays open
- **AND** a later workspace-level `question` does not supersede the detached one

#### Scenario: A decision on a live ticket keeps its ticket

- **WHEN** a decision is created naming a ticket whose status is not terminal
- **THEN** the decision is attached to that ticket exactly as before

#### Scenario: A decision with no ticket is unaffected

- **WHEN** a decision is created naming no ticket
- **THEN** it is created exactly as before

### Requirement: A stale decision on a terminal ticket is withdrawn without touching a live one

The daemon SHALL sweep for decisions that are still `open`, are attached to a ticket whose status is
already terminal, and are older than a grace period, and SHALL withdraw each of them through the same
withdrawal path a terminal ticket transition uses, so a swept decision is auditable as a withdrawal
with a stated reason and never a new closure mechanism.

The sweep SHALL NOT touch a decision whose ticket is not terminal, whatever kind that decision is.
In particular it SHALL NOT close a `plan_approval`, `merge_approval` or `action_approval` on a ticket
that is live, because a live ticket is exactly the case a gate exists to decide.

The sweep SHALL NOT touch a decision newer than the grace period, so a follow-up asked shortly after
its ticket closed survives long enough to be read and answered.

The sweep SHALL run on the same cadence as the approval-integrity scan, and SHALL be unable to
contend with it: the repair scan re-raises approvals only for tickets that are not terminal, so the
two passes operate on disjoint sets of decisions and neither can undo the other's work.

#### Scenario: A stale card on a finished ticket is withdrawn

- **WHEN** a decision attached to a `done` ticket is older than the grace period and the sweep runs
- **THEN** the decision's status becomes `withdrawn`
- **AND** the withdrawal names why it closed without an answer
- **AND** it no longer appears in a query for `open` decisions

#### Scenario: A fresh card on a finished ticket is left for the grace period

- **WHEN** a decision attached to a terminal ticket is newer than the grace period and the sweep runs
- **THEN** it stays `open`

#### Scenario: A gate on a live ticket is never touched

- **WHEN** a `plan_approval` is open on a ticket in `proposed`, or a `merge_approval` on a ticket in
  `in_review`, and the sweep runs more than once
- **THEN** each stays `open`

#### Scenario: The sweep and the approval repair cannot contend

- **WHEN** the approval-integrity scan has just re-raised an approval for a ticket that is not
  terminal, and the stale sweep then runs
- **THEN** the re-raised approval is untouched
