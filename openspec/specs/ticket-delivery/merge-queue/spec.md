# ticket-delivery/merge-queue Specification

## Purpose
Defines how approved merges are landed one at a time per project while any number of workers keep
building in parallel: an approved ticket joins a queue rather than merging immediately, a per-project
concurrency limit decides how many tickets are merging at once, and a merge that fails releases its
place instead of stopping everyone behind it.

## Requirements

### Requirement: An approved merge joins the project's merge queue

A ticket that enters the merging status SHALL join its project's merge queue rather than begin its
merge. Joining SHALL record the moment the ticket joined, and that moment SHALL NOT change while the
ticket remains in the queue. A ticket that joins the queue SHALL NOT be woken to merge until the
queue admits it.

Every path into the merging status — the human answering a merge approval, the auto-merge sweep, the
reconciliation of a pull request merged on the forge, and a direct transition — SHALL enqueue
identically. A ticket with no project SHALL be admitted immediately, since there is no project queue
for it to wait in.

#### Scenario: A merge approval enqueues instead of merging

- **WHEN** the human approves the merge for a ticket whose project already has a ticket in the active
  merge step
- **THEN** the ticket is in the merging status, is recorded as waiting in that project's merge queue,
  and its worker is not woken to merge

#### Scenario: The join time is stable

- **WHEN** a ticket has waited in the queue and the queue is re-evaluated any number of times
- **THEN** the moment it joined the queue is unchanged

#### Scenario: A ticket without a project does not wait

- **WHEN** a ticket that belongs to no project enters the merging status
- **THEN** it is admitted to the active merge step immediately

### Requirement: The queue admits tickets in join order, up to the project's concurrency limit

Each project SHALL have a merge concurrency limit: a whole number of at least one, configurable per
project, defaulting to one. The number of a project's tickets in the active merge step SHALL never
exceed that limit.

While a project has fewer tickets in the active merge step than its limit, the queue SHALL admit
waiting tickets in ascending order of the moment they joined, breaking ties by ticket number.
Admission SHALL record the moment the ticket was admitted, SHALL make the ticket's worker available
(spawning one if the ticket has none), and SHALL wake that worker to perform the merge.

#### Scenario: One at a time by default

- **WHEN** three tickets of a project whose limit is not configured enter the merging status in
  succession
- **THEN** exactly one is in the active merge step and the other two wait

#### Scenario: A raised limit admits more

- **WHEN** three tickets of a project whose merge concurrency is two enter the merging status
- **THEN** two are in the active merge step and the third waits

#### Scenario: Join order decides

- **WHEN** two tickets are waiting and a slot becomes free
- **THEN** the ticket that joined the queue earlier is admitted

#### Scenario: Admission wakes the worker

- **WHEN** a waiting ticket is admitted to the active merge step
- **THEN** its worker is woken with a merge approval wake naming that ticket

### Requirement: Leaving the merging status releases the slot and advances the queue

A ticket that leaves the merging status for any status SHALL leave the queue: its queue and admission
records SHALL be cleared, and the project's queue SHALL immediately admit the next waiting ticket if
its limit allows.

A merge that cannot complete — an unresolvable conflict, red checks, a forge error — leaves the ticket
blocked with a routable action path, and SHALL NOT prevent the queue from advancing.

#### Scenario: A completed merge advances the queue

- **WHEN** the ticket in the active merge step is merged and becomes done
- **THEN** it is no longer in the queue and the next waiting ticket of that project is admitted and its
  worker woken

#### Scenario: A failed merge does not hold the queue

- **WHEN** the ticket in the active merge step becomes blocked because its merge could not complete
- **THEN** it is no longer in the queue, the next waiting ticket is admitted, and the blocked ticket
  retains its routable action path

#### Scenario: A ticket sent back for changes leaves the queue

- **WHEN** a ticket in the active merge step returns to review
- **THEN** it holds no queue slot and the next waiting ticket is admitted

#### Scenario: The queue recovers without a transition

- **WHEN** a project has waiting tickets, fewer tickets in the active merge step than its limit, and no
  ticket transitions
- **THEN** the daemon admits the next waiting ticket on its own, without a human or agent acting

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

### Requirement: A waiting ticket does not consume a worker slot

A ticket waiting in the merge queue SHALL NOT cause a worker to be spawned for it, and SHALL NOT be
reported as a liveness violation while it waits: its place in the queue is its action path. A worker
SHALL be spawned for the ticket, if it has none, when the ticket is admitted to the active merge step.

Consequently a project whose role permits N concurrent workers SHALL be able to have N tickets being
built while the queue lands them one at a time.

#### Scenario: No worker is spawned for a waiting ticket

- **WHEN** a ticket is waiting in the merge queue and has no live worker
- **THEN** the daemon does not spawn a worker for it

#### Scenario: A waiting ticket is not a liveness violation

- **WHEN** the liveness scan runs while a ticket waits in the merge queue with no live run and no
  queued wake
- **THEN** that ticket is not reported as a liveness violation

#### Scenario: Admission brings a worker back

- **WHEN** a waiting ticket with no live worker is admitted to the active merge step
- **THEN** a worker is spawned for it and woken to perform the merge

### Requirement: The merging worker is told it holds the queue

The wake that admits a ticket to the active merge step SHALL tell the worker that it now holds the
project's merge slot and that its base may have moved while it waited, so that the worker syncs its
branch with the current default branch, resolves conflicts, and re-runs the project's checks before
landing.

#### Scenario: The merge turn names the queue

- **WHEN** a worker is woken because its ticket reached the front of the merge queue
- **THEN** its turn states that the ticket holds the project's merge slot and that the default branch
  must be re-synced before merging

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
