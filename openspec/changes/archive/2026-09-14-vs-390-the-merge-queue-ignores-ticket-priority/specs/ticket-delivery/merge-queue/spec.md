## RENAMED Requirements

- FROM: `### Requirement: The queue admits tickets in join order, up to the project's concurrency limit`
- TO: `### Requirement: The queue admits tickets by priority and join order, up to the project's concurrency limit`

## MODIFIED Requirements

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
