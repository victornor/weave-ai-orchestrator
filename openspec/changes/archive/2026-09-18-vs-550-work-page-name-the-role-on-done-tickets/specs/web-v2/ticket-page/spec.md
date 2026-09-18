## ADDED Requirements

### Requirement: The ticket page names the role and the plan a finished ticket came from

The ticket page SHALL label the ticket with the identity of a live worker while one holds it, and
otherwise with the role named by the ticket's `assigneeRoleId`, matching Work's label; a ticket with
neither SHALL read `unassigned`. When the ticket was created from a plan draft, the page SHALL show
the plan's name, distinguish a draft linked before the plan was submitted from one linked at
submission, and link the plan name to the surface where a plan is opened. A ticket with no linked
draft SHALL show nothing extra.

#### Scenario: A finished ticket's page names its role

- **WHEN** a `done` ticket with an assigned role has no live worker
- **THEN** its page names that role and not `unassigned`

#### Scenario: A ticket's page shows its plan origin

- **WHEN** a ticket was created by dispatching a plan draft before submission
- **THEN** its page names the plan and marks it as dispatched while drafting

#### Scenario: A ticket with no plan shows nothing extra

- **WHEN** a ticket has no linked plan draft
- **THEN** its page shows no plan name and no plan mark
