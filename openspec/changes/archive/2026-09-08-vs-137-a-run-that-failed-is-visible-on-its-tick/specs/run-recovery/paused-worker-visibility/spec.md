## MODIFIED Requirements

### Requirement: Every surface that shows a worker shows why it stopped

Wherever the system presents a paused worker to a human — the decision card, the worker's ticket,
the board, the list of workers, the worker's own page and the command line — it SHALL name the
failure family and the runtime's message, and the reset time when one is known.

A surface that shows the ticket rather than the worker SHALL name the same reason on the ticket, so
that a human looking at the work sees why it stopped without opening the worker. This SHALL hold
everywhere a ticket is shown next to its worker's liveness, including the board (both the kanban card
and the phone row), a project's work-in-progress list, and the conductor's own briefing digest — not
only the ticket's own detail page. A ticket surface SHALL NOT determine whether to show this by
whether its worker counts as "live" for other purposes such as column placement; a paused worker is,
by definition, not live, and a lookup that excludes it SHALL NOT be the one a paused-reason display
depends on.

#### Scenario: The board shows the reason

- **WHEN** a ticket whose worker is paused for a usage limit is shown on the board
- **THEN** the card says the work is paused and names the quota family and the runtime's message

#### Scenario: The board shows a login-outage reason too

- **WHEN** a ticket whose worker is paused because its runtime's login expired is shown on the
  board's kanban card or its phone row
- **THEN** the card names that reason, exactly as it would for a usage limit, even though the ticket's
  own status is unchanged and no other agent on the board is affected

#### Scenario: A project's work-in-progress list shows the reason

- **WHEN** a ticket whose worker is paused, for any recorded reason, is shown in a project's list of
  work under way
- **THEN** that entry names the reason, the same as the board would

#### Scenario: The conductor's digest names the reason

- **WHEN** the conductor's own briefing lists a ticket whose worker is paused
- **THEN** that ticket's line in the digest names the worker's status and its pause reason, not only
  the ticket's own status and its latest status comment

#### Scenario: The worker list shows the reason

- **WHEN** the workers are listed, on the web or on the command line, and one is paused after a
  failure
- **THEN** that worker's row names the family and the runtime's message

#### Scenario: A worker with no recorded reason

- **WHEN** a paused worker was paused before the reason was recorded, or was paused without one
- **THEN** the surfaces show it as paused with whatever free-text reason it carries, and show no
  empty or invented failure family
