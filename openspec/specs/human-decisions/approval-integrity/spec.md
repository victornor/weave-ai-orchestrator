# human-decisions/approval-integrity Specification

## Purpose
TBD - created by archiving change vs-104-writing-a-plan-document-no-longer-silent. Update Purpose after archive.

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
