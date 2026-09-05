## MODIFIED Requirements

### Requirement: The merge queue is reportable with each ticket's position

The daemon SHALL report a project's merge queue: its concurrency limit, the tickets in the active
merge step, and the waiting tickets in admission order, each with a position. The first waiting ticket
SHALL have position one. A ticket in the active merge step SHALL be reported as active rather than
carrying a waiting position.

A ticket's own record, when read individually, SHALL report the ticket's merge queue position when it
is waiting.

The command line and the web application SHALL both present this queue, showing for each project which
tickets are merging now and which are waiting, in order. In the web application the queue SHALL have a
place of its own that is addressable, rather than being shown inside a page about something else, and
reaching it SHALL NOT depend on any filter being set.

#### Scenario: Positions are reported in order

- **WHEN** a project's merge queue is read while one ticket merges and two wait
- **THEN** the response names the merging ticket as active and the two waiting tickets with positions
  one and two, in join order

#### Scenario: A waiting ticket knows its own position

- **WHEN** a waiting ticket's record is read individually
- **THEN** it reports the position it holds in its project's merge queue

#### Scenario: An empty queue reports empty

- **WHEN** a project with no ticket in the merging status has its merge queue read
- **THEN** the response is a valid, empty queue carrying that project's concurrency limit

#### Scenario: The web application has a place for the queue

- **WHEN** the merge queue is looked for in the web application
- **THEN** it is shown at an address of its own, and that address is reachable whatever filters are
  set elsewhere in the application

## ADDED Requirements

### Requirement: The queue report carries what recently left it

A project's merge queue report SHALL include the tickets that recently left that project's queue, most
recent first, each naming the ticket, the outcome, and when it left. The outcomes SHALL distinguish a
ticket that landed, one whose merge could not complete, and one that left the queue without landing
and without failing — a ticket sent back for changes or cancelled while it held a place. A ticket that
landed SHALL carry the commit its merge produced when one is known.

The report SHALL be limited to a small, recent window rather than the project's whole history, and a
project that has never had a ticket in its queue SHALL report an empty list rather than an error.

This history SHALL be derived from the record the daemon already keeps of what happened to each
ticket; entering, leaving or advancing the queue SHALL NOT be changed to produce it.

#### Scenario: A landed ticket appears in the recent outcomes

- **WHEN** a ticket of a project completes its merge and the project's merge queue is read
- **THEN** the report names that ticket among the recent outcomes, with the outcome "landed", the time
  it landed, and the merge commit when one was recorded

#### Scenario: A failed merge appears with its outcome

- **WHEN** a ticket in the active merge step becomes blocked because its merge could not complete, and
  the project's merge queue is read
- **THEN** the report names that ticket among the recent outcomes with the outcome "failed" and the
  time it left the queue

#### Scenario: A ticket sent back appears as neither landed nor failed

- **WHEN** a ticket in the active merge step returns to review, and the project's merge queue is read
- **THEN** the report names that ticket among the recent outcomes with an outcome that says it left
  the queue without landing and without failing

#### Scenario: Recent outcomes are ordered and bounded

- **WHEN** more tickets have left a project's queue than the report's window
- **THEN** the report carries only the most recent of them, most recent first

#### Scenario: A project with no history

- **WHEN** a project that has never had a ticket in its merge queue has that queue read
- **THEN** the recent outcomes are an empty list and nothing reports an error

### Requirement: The web application's merge queue view answers what is landing

The web application's merge queue view SHALL show, for one project at a time and without any filter
having to be set: each ticket in the active merge step with how long it has been merging and a way to
open the transcript of the worker performing that merge; each waiting ticket in order with its
position and how long it has waited; how many of the project's merge slots are in use out of its
concurrency limit; and the recent outcomes for that project. Every ticket named in the view SHALL open
that ticket.

When the workspace holds more than one project, the view SHALL let the reader choose which project's
queue is shown, and SHALL remember that choice in its address so the view can be linked to and
reloaded.

When nothing is merging and nothing is waiting, the view SHALL say so in words and SHALL still show
the recent outcomes, so that a reader can tell an idle queue from one that never had anything in it.

#### Scenario: A ticket is merging

- **WHEN** the view is opened for a project with a ticket in the active merge step
- **THEN** it names that ticket, says how long it has been merging, offers a way into the merging
  worker's transcript, and says how many of the project's merge slots are in use

#### Scenario: Tickets are waiting

- **WHEN** the view is opened for a project with waiting tickets
- **THEN** it lists them in queue order with their positions and how long each has waited

#### Scenario: The queue is empty

- **WHEN** the view is opened for a project with nothing merging and nothing waiting
- **THEN** it says the queue is empty and still shows that project's recent outcomes

#### Scenario: Choosing a project

- **WHEN** the reader chooses another project in a workspace with more than one
- **THEN** that project's queue is shown and the view's address names the chosen project

#### Scenario: Opening a ticket from the view

- **WHEN** a ticket named anywhere in the view is chosen
- **THEN** that ticket's page is opened

### Requirement: The board points at the merge queue instead of containing it

The board SHALL NOT render the merge queue among its columns. It SHALL instead carry a single line,
laid out with the board's own filter controls rather than floating over its content, that says how many
of the workspace's tickets are merging now and how many are waiting, and that opens the merge queue
view. That line SHALL be present whatever the board is filtered to, and SHALL say that nothing is
landing when no ticket is in the merging status.

The ticket page SHALL keep showing a ticket's own place in the queue, and that indication SHALL open
the merge queue view for that ticket's project.

#### Scenario: The board carries a pointer, not the queue

- **WHEN** the board is shown while tickets are merging and waiting
- **THEN** no merge queue panel is rendered among the columns, and a single line among the board's
  filters says how many are merging and how many are waiting and opens the merge queue view

#### Scenario: The pointer does not depend on a filter

- **WHEN** the board is shown with no project filter set
- **THEN** that line is still present

#### Scenario: Nothing is landing

- **WHEN** the board is shown while no ticket is in the merging status
- **THEN** that line says nothing is landing and still opens the merge queue view

#### Scenario: The ticket page indication opens the view

- **WHEN** a ticket that is waiting in its project's merge queue has its page opened and its queue
  indication is chosen
- **THEN** the merge queue view for that ticket's project is opened
