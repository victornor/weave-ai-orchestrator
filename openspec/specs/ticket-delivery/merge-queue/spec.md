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

### Requirement: The queue admits tickets by priority and join order, up to the project's concurrency limit

Each project SHALL have a merge concurrency limit: a whole number of at least one, configurable per project, defaulting to one. The number of a project's tickets in the active merge step SHALL never exceed that limit.

While a project has fewer tickets in the active merge step than its limit, the queue SHALL admit waiting tickets in priority order — `critical`, then `high`, then `medium`, then `low` — and among tickets of equal priority in ascending order of the moment they joined, breaking ties by ticket number. A ticket already in the active merge step SHALL NOT be pre-empted: only the order of the waiting tickets changes.

Admission SHALL credit one bypass to every waiting ticket that joined the queue earlier than the ticket being admitted. A waiting ticket that has been credited at least three bypasses SHALL be starved, and starved tickets SHALL be admitted in join order, breaking ties by ticket number, ahead of every ticket that is not starved. A bypass counts only tickets actually admitted ahead of a waiting ticket, never time spent waiting, so a queue that is merely slow does not starve its own tickets. The bypass limit SHALL be the same for every project and SHALL be a named constant. A ticket's bypass count SHALL be cleared when it leaves the queue and when it next joins.

Admission SHALL record the moment the ticket was admitted, SHALL make the ticket's worker available (spawning one if the ticket has none), and SHALL wake that worker to perform the merge. Raising or lowering a waiting ticket's priority SHALL take effect at the next admission with no other action.

#### Scenario: A critical ticket queued behind mediums is admitted next

- **WHEN** a critical ticket joins a project's queue after three medium tickets, none of which has been bypassed, and a merge slot is free or becomes free
- **THEN** the critical ticket is the next one admitted, ahead of the three medium tickets

#### Scenario: Equal priorities keep join order

- **WHEN** two waiting tickets have the same priority
- **THEN** the one that joined the queue earlier is admitted first

#### Scenario: Join order decides

- **WHEN** two tickets of equal priority are waiting and a slot becomes free
- **THEN** the ticket that joined the queue earlier is admitted

#### Scenario: A running merge is never pre-empted

- **WHEN** a critical ticket joins while a lower-priority ticket is already in the active merge step
- **THEN** the active ticket keeps its slot and the critical ticket waits

#### Scenario: Long waiting alone does not starve

- **WHEN** six medium tickets that have each waited more than an hour — none of them bypassed — are waiting, and a critical ticket joins, and a slot is free
- **THEN** the critical ticket is admitted next, because none of the six has been bypassed

#### Scenario: A ticket bypassed the limit is admitted first

- **WHEN** a low-priority ticket has been bypassed three times and a newer critical ticket joins, and a slot is free
- **THEN** the low-priority ticket is admitted before the critical ticket

#### Scenario: A bypass is credited only on a real admission

- **WHEN** a waiting ticket's project admits another ticket that joined later
- **THEN** every waiting ticket of that project that joined before the admitted one is credited one bypass, and no ticket is credited for time alone

#### Scenario: Reprioritising a waiting ticket reorders the queue

- **WHEN** a waiting ticket's priority is raised
- **THEN** the next admission uses its new priority, and its reported position reflects the new order

#### Scenario: One at a time by default

- **WHEN** three tickets of a project whose limit is not configured enter the merging status in succession
- **THEN** exactly one is in the active merge step and the other two wait

#### Scenario: A raised limit admits more

- **WHEN** three tickets of a project whose merge concurrency is two enter the merging status
- **THEN** two are in the active merge step and the third waits

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

The daemon SHALL report a project's merge queue: its concurrency limit, the tickets in the active merge step, and the waiting tickets in admission order, each with a position and the ticket's priority. The first waiting ticket SHALL have position one. A ticket in the active merge step SHALL be reported as active rather than carrying a waiting position.

A waiting ticket that the report orders ahead of at least one ticket that joined the queue earlier and holds a lower priority SHALL be reported as having jumped ahead, so a reader can tell that its position is not its join order.

A ticket's own record, when read individually, SHALL report the ticket's merge queue position when it is waiting.

The command line and the web application SHALL both present this queue, showing for each project which tickets are merging now and which are waiting, in order. In the web application the queue SHALL have a place of its own that is addressable, rather than being shown inside a page about something else, and reaching it SHALL NOT depend on any filter being set.

#### Scenario: Positions are reported in order

- **WHEN** a project's merge queue is read while one ticket merges and two wait at different priorities and join times
- **THEN** the response names the merging ticket as active and the two waiting tickets with positions one and two, in priority then join order, each carrying its priority

#### Scenario: A jumped-ahead ticket is reported

- **WHEN** a project's merge queue is read while a higher-priority ticket is ordered ahead of a ticket that joined earlier
- **THEN** the higher-priority ticket is reported as having jumped ahead and the earlier ticket is not

#### Scenario: A waiting ticket knows its own position

- **WHEN** a waiting ticket's record is read individually
- **THEN** it reports the position it holds in its project's merge queue

#### Scenario: An empty queue reports empty

- **WHEN** a project with no ticket in the merging status has its merge queue read
- **THEN** the response is a valid, empty queue carrying that project's concurrency limit

#### Scenario: The web application has a place for the queue

- **WHEN** the merge queue is looked for in the web application
- **THEN** it is shown at an address of its own, and that address is reachable whatever filters are set elsewhere in the application

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
branch with that ticket's effective landing branch — its own declared landing branch, or otherwise its
project's — resolves conflicts, and re-runs the project's checks before requesting landing.

The worker SHALL prepare its branch — synced, conflict-free, checks passing, pushed — and then request
landing rather than merge the pull request itself. The daemon performs the archive (for a ticket
carrying an OpenSpec change) and the merge as one sequence once the request is made, itself bringing the
branch up to date first when it is merely behind rather than rejecting on staleness alone. A request the
daemon rejects — because the branch has a real conflict the daemon's own rebase could not resolve,
because archiving failed, or because a required check failed on the archived branch — SHALL be treated
by the worker the same way it already treats a rebase conflict: re-sync (or resolve the flagged issue)
and request again.

#### Scenario: The merge turn names the queue

- **WHEN** a worker is woken because its ticket reached the front of the merge queue
- **THEN** its turn states that the ticket holds the project's merge slot and that its effective
  landing branch must be re-synced before requesting landing

#### Scenario: A ticket's own override is named, not its project's landing branch

- **WHEN** a worker is woken because a ticket that declares its own landing branch, overriding its
  project's, reached the front of the merge queue
- **THEN** its turn states that the ticket's own declared landing branch must be re-synced before
  requesting landing

#### Scenario: The worker requests landing instead of merging the pull request itself

- **WHEN** a worker's branch is synced, conflict-free and passing checks
- **THEN** the worker pushes the branch and requests landing, and does not itself merge the pull
  request

#### Scenario: A rejected request is retried like a rebase conflict

- **WHEN** the daemon rejects a worker's landing request because its branch has a real conflict, its
  archive failed, or a required check failed on the archived branch
- **THEN** the worker re-syncs its branch, or resolves the flagged failure, and requests landing again

#### Scenario: Mere staleness never reaches the worker

- **WHEN** a worker requests landing for a branch that is behind the current landing tip but rebases
  onto it with no conflict
- **THEN** the daemon lands the ticket without rejecting the request or waking the worker again

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

The web application's merge queue view SHALL show, for one project at a time and without any filter having to be set: each ticket in the active merge step with how long it has been merging and a way to open the transcript of the worker performing that merge; each waiting ticket in order with its position, how long it has waited, and — when the ticket jumped ahead of an earlier join because of its priority — that priority as a short reason; how many of the project's merge slots are in use out of its concurrency limit; and the recent outcomes for that project. Every ticket named in the view SHALL open that ticket.

When the workspace holds more than one project, the view SHALL let the reader choose which project's queue is shown, and SHALL remember that choice in its address so the view can be linked to and reloaded.

When nothing is merging and nothing is waiting, the view SHALL say so in words and SHALL still show the recent outcomes, so that a reader can tell an idle queue from one that never had anything in it.

#### Scenario: A ticket is merging

- **WHEN** the view is opened for a project with a ticket in the active merge step
- **THEN** it names that ticket, says how long it has been merging, offers a way into the merging worker's transcript, and says how many of the project's merge slots are in use

#### Scenario: A ticket that jumped ahead names its priority

- **WHEN** the view is opened for a project whose waiting order puts a higher-priority ticket ahead of one that joined earlier
- **THEN** that ticket's row carries its priority as a short reason, and a waiting ticket admitted in join order carries no reason

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

### Requirement: The active merge's worker is woken when its pull request's checks resolve

While a ticket is in a project's active merge step — admitted, `merge_started_at` set — and carries a
pull request, the daemon SHALL observe that pull request's state on its own supervisor cadence,
independently of the slower reconciliation pass. It SHALL wake the ticket's live worker when the
checks transition to a resolved state — passing or failing — or when the pull request's merge state
becomes clean. It SHALL NOT wake the worker for a `blocked` merge state while the checks are still
pending, since a forge reports blocked while required checks run, and SHALL NOT treat a draft pull
request with no checks as resolved. The wake SHALL carry the outcome and SHALL be enqueued exactly
once per transition, keyed stably by the ticket, the pull request's head, and the resolved state, so
that a later observation with no change wakes nobody and a repeated pass cannot stack a second turn.
A transition to passing SHALL tell the worker the checks are green and it may request landing; a
transition to failing SHALL tell it the checks failed. The worker SHALL NOT have to poll its own
checks to make progress.

The daemon SHALL poll only tickets in the active merge step, never a ticket still waiting in the
queue, and SHALL bound how often it calls the forge for one ticket so that a deep queue does not
multiply forge calls.

#### Scenario: Checks pass and the worker is woken once

- **WHEN** a merging ticket's pull request checks move from pending to passing
- **THEN** the ticket's live worker is woken once, carrying that the checks passed

#### Scenario: A pass with no state change wakes nobody

- **WHEN** the supervisor observes the same pull request state again with no change
- **THEN** no further wake is enqueued for that ticket

#### Scenario: Checks fail and the worker is woken with the failure

- **WHEN** a merging ticket's pull request checks move from pending to failing
- **THEN** the ticket's live worker is woken once, carrying that the checks failed

#### Scenario: A new head re-arms the transition

- **WHEN** the worker pushes a new head for the same pull request and its checks later resolve
- **THEN** the worker is woken again for that head's resolution, because the transition is keyed to
  the head as well as the state

#### Scenario: A clean merge state wakes the worker

- **WHEN** the forge reports a merging ticket's pull request merge state becoming clean, with its
  checks resolved or absent
- **THEN** the ticket's live worker is woken once with that merge state

#### Scenario: Blocked while checks are pending does not wake

- **WHEN** the forge reports a merging ticket's pull request merge state as blocked while its checks
  are still pending
- **THEN** the ticket's live worker is not woken for the merge state

#### Scenario: A queued merging ticket is not polled

- **WHEN** a ticket is in the merging status but has not been admitted to the active merge step
- **THEN** the daemon does not poll its pull request and does not wake its worker

#### Scenario: A draft pull request does not read as resolved

- **WHEN** a merging ticket's pull request is a draft with no checks
- **THEN** the daemon does not treat it as resolved and does not wake the worker

### Requirement: The merge queue shows what the active merge is waiting on

For a ticket in a project's active merge step, the merge queue SHALL report which of the two the
merge is currently waiting on — CI, while its pull request's checks have not resolved, or the worker,
while the checks have resolved (or there are none) and the worker has not acted since — together with
how long it has been in that state, in addition to how long it has been in the active step. The web
application's merge queue view SHALL show that wait for each active merge, and the board's merge queue
line SHALL show it for the ticket that has been in the active step longest, so an idle slot is
visible as waiting on CI or on the worker rather than as a single unexplained duration.

#### Scenario: An active merge waiting on CI says so

- **WHEN** a project's active merge has checks still pending and the queue is read
- **THEN** the active entry reports that it is waiting on CI and for how long its checks have been
  pending

#### Scenario: An active merge waiting on its worker says so

- **WHEN** a project's active merge has resolved checks and its worker has not acted since and the
  queue is read
- **THEN** the active entry reports that it is waiting on the worker and for how long

#### Scenario: The web view and the board line show the wait

- **WHEN** the merge queue view is opened, or the board is shown, while a ticket is in the active
  merge step
- **THEN** the wait is shown against that ticket, saying whether it is waiting on CI or on the worker
