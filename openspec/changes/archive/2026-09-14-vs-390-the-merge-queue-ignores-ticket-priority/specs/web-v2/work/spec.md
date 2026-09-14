## MODIFIED Requirements

### Requirement: Work shows the merge queue strip and creates tickets

Work SHALL show a merge queue strip carrying how many tickets are landing and how many are waiting,
counted over the tickets the screen loaded, from the project merge queue data (`GET
/projects/:id/merge-queue`) and the loaded tickets. The strip SHALL also name the waiting ticket that
the queue's admission order would take next — across the tickets the screen loaded — and, when that
ticket is ordered ahead of a ticket that joined earlier because of its priority, SHALL show that
priority as the reason. The strip SHALL remain a single line and SHALL truncate rather than wrap or
overflow at narrow widths. Work SHALL offer a **New ticket** control that creates a ticket through the
existing create endpoint and reflects it on the board.

#### Scenario: The merge strip states the queue

- **WHEN** the workspace has tickets in `merging`, some started and some waiting
- **THEN** the strip states how many are landing and how many are waiting, and those figures are
  consistent with the tickets on the board

#### Scenario: The merge strip names who is next

- **WHEN** a higher-priority waiting ticket is ordered ahead of a ticket that joined earlier
- **THEN** the strip names the next waiting ticket and shows its priority as the reason it is next

#### Scenario: A join-order next ticket carries no reason

- **WHEN** the next waiting ticket is in join order with no ticket of lower priority behind it that
  joined earlier
- **THEN** the strip names the next ticket without a reason

#### Scenario: Creating a ticket

- **WHEN** the user creates a ticket from Work
- **THEN** a ticket is created through the existing endpoint and appears on the board
