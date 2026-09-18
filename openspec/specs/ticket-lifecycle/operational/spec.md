# ticket-lifecycle/operational Specification

## Purpose
Defines the `operational` ticket kind: work that changes a running system (a service upgrade, a
deployment, a restart) and therefore has no repository diff to review. The lifecycle matches a
scout — no plan, no PR, no merge — but the safety gate sits *before* the action, and what happened
is recorded afterwards in a report and in the knowledge base, never as an unlanded commit.

## Requirements

### Requirement: An operational ticket kind exists end to end

The system SHALL accept `operational` as a ticket kind wherever a ticket kind is created, listed,
filtered or shown: the shared enum, the persisted `tickets.kind` CHECK, the HTTP and MCP create
and list surfaces, the CLI `--kind` flag, and the web board's kind filter and badge. Existing
kinds `change`, `task`, `scout` and `question` SHALL keep the values and transitions they have
today.

#### Scenario: creating an operational ticket

- **WHEN** a ticket is created with `kind: "operational"`
- **THEN** it is stored as `operational` and appears in kind filters and on the board with that badge

#### Scenario: existing kinds still persist

- **WHEN** a `change`, `task`, `scout` or `question` ticket is created after the kind CHECK is widened
- **THEN** it stores and transitions exactly as it did before `operational` existed

### Requirement: The operational lifecycle has no propose, review or merge

An `operational` ticket SHALL move `todo → done`, optionally through `in_progress` (and the same `blocked` / `cancelled` / reopen edges a `scout` already has). Transitions to `proposing`, `proposed`, `approved`, `in_review` or `merging` SHALL be rejected as graph-invalid. Reaching `done` SHALL NOT raise a `merge_approval` and SHALL NOT require a work product.

#### Scenario: the happy path

- **WHEN** an `operational` ticket in `todo` is transitioned to `in_progress` and later to `done`
- **THEN** both transitions succeed and no `merge_approval` is raised

#### Scenario: finishing without an action

- **WHEN** an `operational` ticket in `todo` whose branch carries no commits missing from its landing branch is transitioned to `done`
- **THEN** the transition succeeds, no `merge_approval` is raised, and no work product is required

#### Scenario: propose and review statuses are unreachable

- **WHEN** an `operational` ticket is transitioned to `proposing`, `proposed`, `in_review` or `merging`
- **THEN** the transition is rejected with error code `invalid_disposition`
- **AND** the allowed list does not include those statuses

### Requirement: An operational ticket binds no OpenSpec change

Creating or transitioning an `operational` ticket SHALL NOT assign `openspecChangeName` and SHALL
NOT demand OpenSpec planning artifacts. The `proposed` OpenSpec validation gate SHALL not run for
this kind, because `proposed` is not on its graph.

#### Scenario: no change name

- **WHEN** an `operational` ticket is created in an OpenSpec-enabled project
- **THEN** `openspecChangeName` remains null

#### Scenario: proposed is not required

- **WHEN** an `operational` ticket moves from `in_progress` to `done`
- **THEN** no OpenSpec validation runs and the transition is not refused for missing artifacts

### Requirement: An action that changes a running system waits for human approval

Before taking an action that changes a running system, the worker SHALL write an `action` document
on the ticket stating the concrete commands, the host or service they target, and the expected
outcome. Writing that document on an `operational` ticket SHALL raise a human-owned
`action_approval` decision targeting that revision, with options `approve`, `revise` and `reject`.
The worker SHALL end its turn and SHALL NOT execute the action while that decision is `open`.

The owner SHALL be `human` regardless of YOLO mode, `proposalApproval` policy, or who wrote the
document. A later write to the same `action` key SHALL supersede any still-open `action_approval`
and raise a new one targeting the new revision.

Answering `approve` SHALL leave the ticket `in_progress` and wake the worker to execute. Answering
`revise` SHALL leave the ticket `in_progress`, record the feedback on the ticket, and wake the
worker to rewrite the action. Answering `reject` SHALL cancel the ticket.

Writing an `action` document on a non-operational ticket SHALL store the document and SHALL NOT
raise an `action_approval`.

#### Scenario: proposing an action

- **WHEN** a worker writes an `action` document on an `operational` ticket in `in_progress`
- **THEN** an `action_approval` owned by the human is raised, targeting that revision, with options
  `approve`, `revise` and `reject`
- **AND** the ticket stays `in_progress`

#### Scenario: the worker waits

- **WHEN** an `action_approval` is `open` on an `operational` ticket
- **THEN** the worker is not expected to execute the action, and a later write of `action`
  supersedes the open approval and raises a new one

#### Scenario: approve executes, reject cancels

- **WHEN** the human answers an `action_approval` with `approve`
- **THEN** the ticket remains `in_progress` and the worker is woken
- **WHEN** the human answers with `reject`
- **THEN** the ticket is `cancelled`

#### Scenario: YOLO does not grant it

- **WHEN** an `action_approval` is raised for a ticket whose project has YOLO mode on
- **THEN** the decision stays `open` and is not answered by the daemon

### Requirement: After acting, the outcome is recorded without a repository commit

After the approved action runs, the worker SHALL write a `report` document stating what was
approved, what actually happened, and any difference. Operational knowledge — what was done, when,
to what, and anything the next operator would want — SHALL go in the project knowledge base.
A change that belongs in repository documentation SHALL be filed as a follow-up `change` ticket;
the operational ticket SHALL NOT commit that documentation on its own branch.

An `operational` ticket MAY finish at `done` without an `action` document when no action that
changes a running system was taken, provided the `report` records that.

#### Scenario: the report names the difference

- **WHEN** an approved action has been executed
- **THEN** the ticket has a `report` document that states what was approved, what happened, and
  whether they differed

#### Scenario: repo docs are a follow-up

- **WHEN** repository documentation needs to change as a result of the operation
- **THEN** a follow-up `change` ticket is filed for that documentation and the operational ticket
  itself has no commits to land

### Requirement: Done is refused while the branch carries unlanded commits

An `operational` ticket SHALL NOT be transitioned to `done` while its branch carries commits that
are not contained in its landing branch — by ancestry or by patch-id equivalence — regardless of
the transitioning actor. A missing or unreadable worktree SHALL NOT block `done`. This gate is
independent of the `task` done gate: it does not require a transition note, and it does not apply
to `change`, `task`, `scout` or `question`.

#### Scenario: commits on the branch

- **WHEN** an `operational` ticket's branch has commits not contained in its landing branch and a
  transition to `done` is requested
- **THEN** the transition is rejected with error code `worktree_not_landed`
- **AND** the ticket keeps its previous status

#### Scenario: no worktree does not block

- **WHEN** the ticket has no worktree, or the worktree cannot be read
- **THEN** a transition to `done` is not refused for unlanded commits

### Requirement: Waiting on an action approval is not a liveness or stall fault

An `operational` ticket that is `in_progress` with an `open` `action_approval` SHALL be treated as
having an action path. It SHALL NOT appear in liveness violations and its worker SHALL NOT be
detected as stalled for that wait alone.

#### Scenario: open action approval is an action path

- **WHEN** an `operational` ticket is `in_progress` with an `open` `action_approval` and no queued
  wake or running run
- **THEN** it is not a liveness violation and its worker is not detected as stalled
