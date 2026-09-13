## ADDED Requirements

### Requirement: A held merge approval whose head moves wakes the weaver

When the weaver marks an open `merge_approval` **looked at, with concerns**, the daemon SHALL record on that decision the delivery head the review was made against. The delivery head SHALL be resolved generally: the pull request's head when the ticket has a pull request and its forge reports one, otherwise the ticket branch's head from its worker worktree, otherwise the project clone's branch ref. A mark SHALL still succeed when no head can be resolved; the decision then simply carries no recorded head.

While that decision stays `open` and marked **looked at, with concerns**, the daemon SHALL compare the ticket's current delivery head against the recorded head both at the end of a worker's turn and on its periodic pull-request reconcile. When the current head differs from the recorded head, it SHALL enqueue exactly one wake for the workspace's weaver, naming the ticket and the new commit, and carrying the decision's id and the new head in its payload.

The wake SHALL be idempotent per (decision, head): the same new head observed again SHALL NOT enqueue a second wake, whether from the turn-end check or the reconcile, and a further new head SHALL enqueue one more. The wake is a notification only: it SHALL NOT set, clear, or otherwise change any review state, and it SHALL NOT itself lift the hold.

A decision marked **looked at**, a decision not yet reviewed, or a decision that is no longer `open` (answered, superseded, withdrawn, expired) SHALL NOT produce this wake. A `plan_approval` or `action_approval` SHALL NOT produce it however it is marked or however its ticket moves.

#### Scenario: A pushed fix wakes the weaver once

- **WHEN** an open `merge_approval` is marked **looked at, with concerns** while the delivery head is `sha1`, and a worker later pushes `sha2`
- **THEN** exactly one wake is enqueued for the weaver, naming the ticket and `sha2`, and the decision remains `open` and marked **looked at, with concerns**

#### Scenario: The same head does not wake again

- **WHEN** the daemon observes the same delivery head `sha2` again at the end of a later turn or on a later reconcile
- **THEN** no further wake is enqueued for the weaver

#### Scenario: A second new commit wakes again

- **WHEN** a held merge approval has already woken for `sha2` and the delivery head later moves to `sha3`
- **THEN** one more wake is enqueued for the weaver, naming `sha3`

#### Scenario: A looked mark produces no wake

- **WHEN** an open `merge_approval` is marked **looked at** and its delivery head later moves
- **THEN** no wake is enqueued for the weaver

#### Scenario: An unreviewed merge approval produces no wake

- **WHEN** an open `merge_approval` whose review state is **not looked at yet** has its delivery head moved
- **THEN** no wake is enqueued for the weaver

#### Scenario: A plan approval produces no wake

- **WHEN** an open `plan_approval` is marked **looked at, with concerns** and its ticket's delivery head moves
- **THEN** no wake is enqueued for the weaver by this requirement

#### Scenario: The head recorded at the review does not wake

- **WHEN** a merge approval is marked **looked at, with concerns** at head `sha1` and the daemon next observes `sha1`
- **THEN** the delivered head is unchanged and no wake is enqueued

#### Scenario: A mark with no resolvable head still lands

- **WHEN** a merge approval is marked **looked at, with concerns** while no delivery head can be resolved
- **THEN** the mark succeeds, and the first head observed afterwards is recorded as the baseline without waking the weaver

#### Scenario: A local-branch delivery wakes on the branch head

- **WHEN** a ticket delivers on a local branch with no pull request, is held under **looked at, with concerns**, and its branch head moves
- **THEN** one wake is enqueued for the weaver, naming the ticket and the new commit
