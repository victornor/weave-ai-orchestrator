# ticket-delivery/promotion Specification

## Purpose
Defines the second half of land-then-promote delivery for a project whose landing branch differs from its
default branch: how the human promotes the landing branch to the default branch inside Weave through a
project-scoped approval, how the daemon performs that merge and nothing else does, and how tickets read
before and after it.

## Requirements

### Requirement: A ticket is done when it is on its landing branch

For a ticket whose effective landing branch differs from its project's default branch, the ticket SHALL
finish when its work is verified on the landing branch. Its delivery state SHALL read "on {landing}" using
the actual branch name until it is promoted. A worker SHALL NOT open, retarget or merge a pull request
against the project's default branch to satisfy verification.

#### Scenario: A change ticket's PR targets the landing branch
- **WHEN** a change ticket of a project landing on `edge` (default `main`) opens its pull request
- **THEN** the pull request's base is `edge`

#### Scenario: Merge done on the landing branch finishes the ticket
- **WHEN** that pull request is merged to `edge` and the worker reports the merge done
- **THEN** verification passes against `edge`, the ticket is done, and it carries the delivery badge "on edge"

#### Scenario: Merge card names the landing branch
- **WHEN** a merge approval is raised for such a ticket
- **THEN** its title and copy read "Land on edge" and do not describe a merge to the default branch

#### Scenario: A project with no distinct landing branch is unchanged
- **WHEN** a project's landing branch equals its default branch
- **THEN** merge cards, badges and verification behave exactly as before

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

### Requirement: The project states what going live does

A project SHALL be able to declare short go-live notes, which the promotion card SHALL display verbatim
alongside the range. The daemon SHALL NOT invent deployment facts.

#### Scenario: Declared notes appear on the card
- **WHEN** a project declares that a push to main deploys production
- **THEN** the promotion card shows that note

### Requirement: Only a reviewed, human answer promotes

An approving answer to a `promotion_approval` SHALL be accepted only from a human, only after the weaver
has marked the card looked at the current landing and default heads, and never through YOLO, auto-merge or
any system grant. A head that moved after the review mark SHALL hold the approval until it is reviewed
again.

#### Scenario: YOLO does not promote
- **WHEN** a workspace has YOLO on and a promotion card is open
- **THEN** the card stays open until a human answers it

#### Scenario: A moved head holds the approval
- **WHEN** landing gains a commit after the weaver marked the card looked
- **THEN** approving is held until the weaver reviews the new head

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

### Requirement: A hotfix lands on the default branch by explicit declaration

A ticket SHALL land on the default branch only when its `landingBranch` was set to it at creation because
the human said to land on production. It SHALL NOT be inferred from a pull request's base branch. After
such a ticket lands, the next promotion card SHALL state that the landing branch is behind the default
branch.

#### Scenario: Hotfix ticket lands on main
- **WHEN** a ticket is created with landingBranch main in a project landing on edge, and it lands
- **THEN** it is done with the state "in production" and the next promotion card reports edge behind main

### Requirement: Agents never ask the human to hand-merge a promotion

Weaver and worker instructions SHALL direct promotion through the promote action. The daemon opens and, on
the human's approval, merges the promotion pull request; neither agent SHALL ask the human to merge a
landing-to-default pull request on the forge by hand.

#### Scenario: Weaver copy

- **WHEN** the weaver tells the human a project has landed work awaiting production
- **THEN** it points to the project's Promote control and does not suggest `gh pr merge`

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
