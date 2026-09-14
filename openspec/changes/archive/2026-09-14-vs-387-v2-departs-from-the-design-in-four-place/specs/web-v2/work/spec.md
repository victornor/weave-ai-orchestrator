## MODIFIED Requirements

### Requirement: Empty columns are narrow and cards widen them

A column with no cards SHALL render narrow (about 108px), and a column holding at least one card
SHALL render wide enough to hold cards. An empty column SHALL be styled identically to the others —
no tint, no "Empty" label, no placeholder text. The narrow width SHALL be asserted on the rendered
element, not only on an emptiness marker, and a column that gains a card SHALL widen in place.

#### Scenario: An empty column

- **WHEN** a column has no tickets
- **THEN** it renders as a narrow strip with its name and a zero count and no card content

#### Scenario: A populated column

- **WHEN** a column holds at least one card
- **THEN** it renders wide enough for its cards and narrow columns beside it stay narrow

#### Scenario: A column widens when a card arrives

- **WHEN** a column that was empty gains a ticket, without a reload
- **THEN** that column renders wide enough for its card while the still-empty columns stay narrow

### Requirement: A card carries its project, tags, worker role and age

Every kanban card SHALL show the ticket's project tag at its top-right, in the project's own hue,
its kind and tier tags wrapped on their own line, and the worker role on its own bottom row under a
hairline with the age beside it, so a long role name is not truncated. A card SHALL NOT carry a tag
that restates the status of the column it sits in — the column already names the owner of the next
move — and the tier tag SHALL be the one from the design, including its fallback for a ticket that
names no worker-model option. The card SHALL open the ticket when activated.

#### Scenario: A card's anatomy

- **WHEN** a card for a ticket with a project and an assigned worker renders
- **THEN** the project tag appears top-right in that project's hue, the kind and tier tags appear
  above the hairline, and the worker role and age appear below the hairline

#### Scenario: No tag restates the column

- **WHEN** a card renders in a column
- **THEN** none of its tags repeats that column's status (a Backlog card carries no "backlog" or
  "Backlog" tag, an In progress card carries no "in progress" tag)

#### Scenario: A card opens its ticket

- **WHEN** the user activates a card
- **THEN** the app navigates to that ticket's V2 ticket page
