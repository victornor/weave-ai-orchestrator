## MODIFIED Requirements

### Requirement: Promotion is a project-scoped approval, never a ticket or a worker

The daemon SHALL support a `promotion_approval` decision that belongs to a project and to no ticket. It
SHALL only be raised through a project's promote action, only for a project whose landing branch differs
from its default branch, and only when landing holds content the default branch lacks — a non-empty tree
diff between the two branches, not merely a non-zero commit count. It SHALL NOT be raisable through the
general ask tool, and at most one SHALL be open per project. The card SHALL show the tickets whose work is
in the landing-versus-default range, the changed-file summary of that content, the project's declared
go-live consequences, and how the daemon intends to promote it (a pull request or a direct push) with the
merge method it will use.

#### Scenario: The Promote control shows how far landing is ahead

- **WHEN** a human opens a project whose landing branch holds content its default branch lacks
- **THEN** the project shows the changed files and the tickets waiting, and offers a Promote control

#### Scenario: Tapping Promote raises the card for the human

- **WHEN** Promote is requested
- **THEN** one open `promotion_approval` is created, owned by the human, and no worker is woken to act on it

#### Scenario: Nothing to promote

- **WHEN** landing's content is already on the default branch (the tree diff is empty), including after a
  squash promotion
- **THEN** no promotion card is raised and the control reports that nothing is waiting

#### Scenario: The card is not askable

- **WHEN** an agent tries to create a `promotion_approval` through the general ask tool
- **THEN** the request is rejected

### Requirement: Promoted tickets read in production and never reopen

When a promotion succeeds, every ticket whose landed work is contained in the promoted range SHALL show
the delivery state "in production". A promotion SHALL record the commit the forge reports for the merge
(a squash rewrites the ticket commits, so ancestry alone is not proof) and SHALL stamp the included
tickets as promoted; a ticket so stamped SHALL NOT read as unpromoted merely because its landed commit is
not an ancestor of the default branch. No ticket's status SHALL change and no ticket SHALL reopen, and a
later card SHALL NOT list content already promoted.

#### Scenario: Included tickets flip

- **WHEN** a promotion succeeds
- **THEN** each ticket in the range reads "in production" and stays done

#### Scenario: Later landing is not in production

- **WHEN** a ticket lands on `edge` after a promotion
- **THEN** it reads "on edge"

### Requirement: Agents never ask the human to hand-merge a promotion

Weaver and worker instructions SHALL direct promotion through the promote action. The daemon opens and, on
the human's approval, merges the promotion pull request; neither agent SHALL ask the human to merge a
landing-to-default pull request on the forge by hand.

#### Scenario: Weaver copy

- **WHEN** the weaver tells the human a project has landed work awaiting production
- **THEN** it points to the project's Promote control and does not suggest `gh pr merge`

## REMOVED Requirements

### Requirement: The daemon promotes by fast-forward, and nothing else does

**Reason**: A default branch that requires a pull request (Fernwood's `main`) rejects a direct push, so a
fast-forward-only promotion has no route forward. Promotion may now go through the forge's pull-request
path, with a direct push kept only where the repository or project policy allows it.

**Migration**: The promotion service resolves a strategy (see "Promotion strategy is a safe-by-default
project policy"). A project with a forge that can open pull requests promotes by pull request by default;
a project with no forge, or one whose policy sets a direct push, keeps the previous fast-forward push over
the same reviewed head and under the same landing lock.

#### Scenario: Approved promotion fast-forwards the default branch

- **WHEN** a human approves a reviewed promotion card and edge is a descendant of main
- **THEN** the daemon pushes main to the reviewed edge head and records the promotion

#### Scenario: Non-fast-forward is held

- **WHEN** main holds a commit edge does not (a hotfix)
- **THEN** no push occurs, the card is held stating landing is behind the default branch and naming the
  commits it lacks, and Promote is not offered

#### Scenario: Only the reviewed head is promoted

- **WHEN** landing moved after approval was requested but before the push
- **THEN** the daemon promotes nothing and leaves the card open for review of the new head

## ADDED Requirements

### Requirement: The daemon promotes through the forge, and nothing else does

On approval, the daemon SHALL promote by the project's resolved strategy. Where a pull request is
required or chosen, it SHALL open or reuse a pull request from the landing branch to the default branch
and merge it with a merge method the repository allows, waiting for the repository's required checks to
pass. Where a direct push is allowed, it SHALL push the reviewed landing head by fast-forward from the
daemon's own clone. In no case SHALL the daemon force-push, admin-merge or change a repository rule. If
required checks fail or cannot run, the pull request cannot merge, or landing moved after review, the
promotion SHALL NOT complete and SHALL be held with the reason named. No worker, and no other daemon path,
SHALL push or merge into the default branch.

#### Scenario: An approved promotion merges the pull request

- **WHEN** a human approves a reviewed promotion card on a project promoting by pull request and the
  required checks pass
- **THEN** the daemon merges that pull request and records the promotion with the forge's merge commit

#### Scenario: A pull request is reused, never duplicated

- **WHEN** a promotion pull request from the landing branch to the default branch is already open
- **THEN** the daemon merges that pull request and opens no second one

#### Scenario: A failed required check holds the promotion

- **WHEN** a required check fails on the promotion pull request
- **THEN** no merge occurs and the promotion is held with the failing check named

#### Scenario: A repository rule is never bypassed

- **WHEN** a merge or push is refused by a repository rule, protection or required check
- **THEN** the daemon completes nothing and holds the promotion with the forge's reason, without a force
  push, an admin merge or a ruleset change

#### Scenario: A squash promotion does not re-list its tickets

- **WHEN** a promotion merges by squash and the merged ticket commits are consequently not ancestors of
  the default branch
- **THEN** the included tickets read "in production", the next card lists only content not yet promoted,
  and none reopens

### Requirement: A promotion pull request carries honest, complete content

A promotion pull request SHALL carry a title, derived from the project's `promotionPrTitle` policy when
set and otherwise generated from the landing and default branches. Its body SHALL fill the repository's
pull-request template where one exists, SHALL state the tickets the promotion carries and a changed-file
summary of the content being promoted, SHALL keep the commit list only as labelled detail, and SHALL
state the project's declared go-live notes. The daemon SHALL NOT leave a required template section blank
and SHALL NOT invent a claim it cannot support; a section it cannot fill SHALL say that a human must
confirm it.

#### Scenario: The template's sections are accounted for

- **WHEN** the repository has a pull-request template
- **THEN** every section of the template is filled with a fact the daemon knows or explicitly marked as
  requiring human confirmation, and none is left blank

#### Scenario: The tickets and the tree diff are stated

- **WHEN** a promotion pull request is opened
- **THEN** its body names the tickets in the range and the changed files, insertions and deletions of the
  content being promoted

#### Scenario: No safety claim is invented

- **WHEN** the template has a safety or database section the daemon cannot verify
- **THEN** the body marks it as requiring human confirmation and asserts nothing about it

### Requirement: Promotion strategy is a safe-by-default project policy

A project SHALL declare a promotion strategy: `auto`, `pull-request` or `direct-push`, defaulting to
`auto`. Under `auto`, the daemon SHALL promote by pull request whenever a forge able to open pull requests
is available for the project, and by direct push only when no such forge is available. `direct-push` SHALL
be an explicit policy choice and SHALL never be selected by default. A direct push a repository refuses
SHALL leave the card held with the remote's reason and a message naming the pull-request path, rather than
a dead end.

#### Scenario: A forge-capable project promotes by pull request

- **WHEN** a project with an available forge promotes under `auto`
- **THEN** the promotion goes through a pull request

#### Scenario: A project with no forge keeps the direct push

- **WHEN** a project has no forge able to open pull requests and its policy is `auto`
- **THEN** the promotion uses the fast-forward direct push as before

#### Scenario: A rejected direct push names the pull-request path

- **WHEN** a direct push is refused by the remote
- **THEN** the card is held with the remote's reason and names promotion through a pull request as the
  route forward

### Requirement: A promotion reports its progress and holds with a reason

While a promotion is in flight — its pull request open and its required checks running — the project's
promotion surface SHALL show the pull-request link and its state, and the merge method in use. When the
promotion is held because a check failed, a merge was refused or landing moved, the surface SHALL name
the reason. The surface SHALL never sit in an unexplained state.

#### Scenario: Progress is visible while checks run

- **WHEN** a promotion pull request's required checks are still running
- **THEN** the project's promotion surface shows the pull-request link, the running state and the merge
  method

#### Scenario: A held promotion names its reason

- **WHEN** a promotion cannot complete
- **THEN** the promotion surface states why, and a human can raise a fresh card once it is resolved

#### Scenario: A moved landing head cannot be merged unreviewed

- **WHEN** the landing branch gains a commit after the weaver reviewed the card
- **THEN** the daemon merges nothing and holds the promotion until the new head is reviewed
