## ADDED Requirements

### Requirement: Plan limits can be re-synced on demand

The system SHALL let a client ask for an immediate account probe, for one named runtime or for every
runtime the workspace is spending on, and SHALL answer with the current snapshot of each runtime it
was asked about, whether or not that snapshot was just replaced. The answer SHALL say which runtimes
were probed, which were refused because they were probed too recently, and which were probed and
failed.

An on-demand sync SHALL be rate limited per workspace and runtime. A sync requested within the rate
limit window of the previous on-demand sync of that runtime SHALL NOT probe the runtime again, and
SHALL NOT be reported as an error: it SHALL return that runtime's current snapshot together with the
time at which the next sync of it is allowed. The window SHALL be per runtime, so that a runtime
which has just been synced does not hold up one which has not. The recurring daemon poll SHALL
neither consume the window nor be delayed by it — a snapshot must keep being refreshed on its own
however often a human asks for one.

Unlike the poll, an on-demand sync SHALL report a probe that failed, naming the runtime and the
reason, so that the numbers on screen are not left reading as freshly synced when nothing was
synced. The failed runtime's previous snapshot SHALL still be left in place.

`conductor usage` SHALL offer the same sync before it prints, and SHALL say what was synced, what
was refused as too recent, and what failed.

#### Scenario: Syncing one runtime

- **WHEN** a client asks for an immediate sync of a named runtime
- **THEN** that runtime's account is described again, its stored snapshot is replaced with a new
  capture time, and the answer carries the new snapshot and names the runtime as synced

#### Scenario: Syncing every runtime the workspace spends on

- **WHEN** a client asks for an immediate sync without naming a runtime
- **THEN** the runtimes the recurring poll would refresh are the ones probed, and the answer carries
  a snapshot for each

#### Scenario: Asking again too soon

- **WHEN** a second on-demand sync of the same runtime is requested inside the rate limit window
- **THEN** the runtime is not probed again, the request is not an error, and the answer carries that
  runtime's current snapshot together with the time the next sync of it is allowed

#### Scenario: A second runtime is not held up

- **WHEN** one runtime is inside its rate limit window and a sync of another runtime is requested
- **THEN** the other runtime is probed

#### Scenario: The poll is unaffected

- **WHEN** a runtime has just been synced on demand and the recurring poll then runs
- **THEN** the poll describes that runtime as it always does, and the poll does not itself consume
  the on-demand rate limit window

#### Scenario: An on-demand sync whose probe fails

- **WHEN** describing an account throws or times out during an on-demand sync
- **THEN** the answer names that runtime as failed with the reason, and the previously stored
  snapshot is left unchanged

#### Scenario: The CLI syncs before printing

- **WHEN** `conductor usage` is run with its sync flag
- **THEN** an on-demand sync runs before the usage is printed, and the output says what was synced,
  what was refused as too recent and what failed
- **AND** without the flag no sync is requested

## MODIFIED Requirements

### Requirement: The usage view leads with plan limits on subscription accounts

When every token in the queried scope and window was billed as `subscription_included`, the usage
view SHALL show the plan limits and SHALL NOT show a dollar figure for that window. Otherwise it
SHALL show dollar cost exactly as it does when no snapshot exists, and where that window contains
both subscription usage and metered or unclassified usage the view SHALL say that this is why the
cost is still shown.

Where limits are shown, the view SHALL show the plan label, each limit window with its utilisation
and its reset time, and how long ago the snapshot was captured. That age SHALL be shown beside the
numbers it belongs to, and SHALL be worded as the time since the account was last synced rather than
as a bare duration, so that it cannot be read as anything else. Where an account reports no limits,
the view SHALL say the limits are unavailable, with the account's note, and SHALL NOT draw a zero.

Where the account could not be described at all, the view SHALL say that the probe failed rather
than that the plan has no limits, and SHALL show the account's note and the capture time.

The view SHALL offer an on-demand sync of each runtime it shows. While that sync is in flight the
control SHALL say so and SHALL NOT accept a second request for the same runtime; when it completes
the shown numbers and the shown age SHALL be those of the returned snapshot, without a reload. A
sync whose probe failed, and one refused as too recent, SHALL each say so in place, next to the
runtime it was asked for.

The view SHALL also state how often the daemon refreshes the snapshots on its own, so that a human
looking at the age can tell whether syncing by hand would tell them anything new.

`conductor usage` SHALL present the same information as the web usage view for the same query.

#### Scenario: A window billed entirely to a subscription

- **WHEN** the usage view loads a window in which every recorded token was `subscription_included`
- **THEN** it shows the plan label and each limit window with its utilisation and reset time
- **AND** no dollar figure is shown for that window

#### Scenario: A window with metered usage

- **WHEN** the usage view loads a window containing any `metered_api` or `unknown` tokens
- **THEN** the dollar cost is shown as before, labelled reported or estimated
- **AND** where the window also contains subscription usage, the view states that the mix is why
  the cost is shown

#### Scenario: A subscription account whose limits are unavailable

- **WHEN** the usage view shows an account whose snapshot has `limitsAvailable` false
- **THEN** it states that the limits are unavailable and shows the account's note
- **AND** it does not render any limit window at zero

#### Scenario: An account the probe could not describe

- **WHEN** the usage view shows an account whose snapshot is `unknown` billing with a note
- **THEN** it states that the account probe failed, and shows the note and how long ago the
  snapshot was captured

#### Scenario: The CLI shows the same

- **WHEN** `conductor usage` is run for a scope and window whose tokens were all
  `subscription_included`
- **THEN** it prints the plan label, each limit window with its utilisation and reset time, and the
  snapshot's age, and it does not print a cost line

#### Scenario: No snapshot at all

- **WHEN** the usage view or `conductor usage` loads a workspace with no account snapshots
- **THEN** the output is exactly what it is today: tokens, cost, runs, with no plan section

#### Scenario: Syncing from the usage view

- **WHEN** the human uses the sync control on a runtime's plan block
- **THEN** the control reports that the sync is in flight and refuses a second request for that
  runtime until it finishes
- **AND** when it finishes the block shows the returned snapshot's numbers and its age, without a
  reload

#### Scenario: A sync from the usage view that fails or is refused

- **WHEN** a sync requested from the usage view fails, or is refused because that runtime was synced
  too recently
- **THEN** the reason is shown next to that runtime rather than the numbers silently standing as if
  they had just been refreshed
