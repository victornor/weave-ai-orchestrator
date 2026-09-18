# ticket-delivery/promotion Specification

## Purpose
Defines the second half of land-then-promote delivery for a project whose landing branch differs from its
default branch: how the human promotes the landing branch to the default branch inside Weave through a
project-scoped approval, how the daemon performs that merge and nothing else does, and how tickets read
before and after it.

## ADDED Requirements

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
from its default branch, and only when landing holds commits the default branch lacks. It SHALL NOT be
raisable through the general ask tool, and at most one SHALL be open per project. The card SHALL show the
tickets whose work is in the landing-versus-default range, the commit range, and the project's declared
go-live consequences.

#### Scenario: The Promote control shows how far landing is ahead
- **WHEN** a human opens a project whose landing is ahead of its default branch
- **THEN** the project shows the number of commits ahead and the tickets waiting, and offers a Promote control

#### Scenario: Tapping Promote raises the card for the human
- **WHEN** Promote is requested
- **THEN** one open `promotion_approval` is created, owned by the human, and no worker is woken to act on it

#### Scenario: Nothing to promote
- **WHEN** landing has no commits the default branch lacks
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

### Requirement: The daemon promotes by fast-forward, and nothing else does

On approval, the daemon SHALL update the project's default branch to the landing branch head by
fast-forward only, pushing it from the daemon's own clone. No worker, and no other daemon path, SHALL push
or merge into the default branch. If landing cannot be fast-forwarded onto the default branch, the daemon
SHALL NOT push, the card SHALL remain open and held with the reason named, and it SHALL offer no Promote.
A remote that rejects the push SHALL leave the card open with the remote's reason.

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

### Requirement: Promoted tickets read in production and never reopen

When a promotion succeeds, every ticket whose landed work is contained in the promoted range SHALL show
the delivery state "in production". No ticket's status SHALL change and no ticket SHALL reopen.

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

Weaver and worker instructions SHALL direct promotion through the promote action and SHALL NOT ask the
human to merge a landing-to-default pull request on the forge.

#### Scenario: Weaver copy
- **WHEN** the weaver tells the human a project has landed work awaiting production
- **THEN** it points to the project's Promote control and does not suggest `gh pr merge`
