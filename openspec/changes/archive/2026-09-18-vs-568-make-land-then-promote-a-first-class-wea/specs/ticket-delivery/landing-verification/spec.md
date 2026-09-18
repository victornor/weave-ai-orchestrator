## MODIFIED Requirements

### Requirement: A project may declare a landing branch distinct from its default branch

A project SHALL be able to declare, optionally, the branch its tickets' work is expected to reach:
its landing branch. When a project declares no landing branch, its landing branch SHALL be its default
branch, so that a project which declares nothing behaves exactly as it did before this capability
existed. Promoting a project's landing branch to its default branch — merging `edge` into `main`, in
Fernwood's case — SHALL be performed by the daemon only, and only through an approved project-scoped
promotion approval (see `ticket-delivery/promotion`). No worker, and no other part of the daemon, ever
pushes or merges that promotion.

#### Scenario: A project with no declared landing branch behaves as before

- **WHEN** a project declares no landing branch
- **THEN** every check that verifies where a ticket's work has landed runs against that project's
  default branch, exactly as before landing branches existed

#### Scenario: A declared landing branch is used instead of the default branch

- **WHEN** a project declares a landing branch different from its default branch
- **THEN** every check that verifies where a ticket's work has landed runs against the declared
  landing branch, and none of them touch the default branch

#### Scenario: Promotion stays a human's action

- **WHEN** a project's landing branch differs from its default branch
- **THEN** nothing merges or pushes the landing branch into the default branch except the daemon acting
  on a human-approved promotion approval
