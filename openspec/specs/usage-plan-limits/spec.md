# usage-plan-limits Specification

## Purpose
Describes how AgentConductor learns whether a coding CLI's account is billed per token or included
in a subscription, how it keeps that account's plan limit windows fresh, and what the usage view and
`conductor usage` show for each kind of account.

## Requirements

### Requirement: A runtime adapter describes its account

A runtime adapter MAY describe the account its credentials belong to. The description SHALL carry a
billing mode of `metered_api`, `subscription_included` or `unknown`, an optional human-readable plan
label, whether limit windows are available, the limit windows themselves when they are, and a note
explaining why they are not when they are not. An adapter that cannot determine any of this SHALL
NOT provide a description, and the system SHALL treat that as `unknown` billing with no limits.

Every limit window SHALL carry a kind, a display label, a utilisation percentage between 0 and 100,
a reset time when the runtime reports one, and an optional scope label naming the model the window
applies to. A window whose utilisation the runtime does not report SHALL be omitted, never reported
as zero.

Describing an account SHALL NOT consume model tokens and SHALL NOT start or resume an agent session.

#### Scenario: Claude Code on a subscription

- **WHEN** the Claude Code adapter describes an account whose credentials are a Claude subscription
- **THEN** the description has billing mode `subscription_included`, the plan label from the
  runtime's reported subscription type, `limitsAvailable` true, and one window for the rolling
  session limit, one for the weekly limit, and one per model-scoped weekly limit the runtime reports
- **AND** each window carries its utilisation percentage and its reset time

#### Scenario: Claude Code on an API key

- **WHEN** the Claude Code adapter describes an account that reports no subscription type
- **THEN** the description has billing mode `metered_api`, `limitsAvailable` false, and a note
  saying the account is billed per token

#### Scenario: Claude Code reports no limits

- **WHEN** the Claude Code adapter describes an account and the runtime reports that rate limits are
  unavailable
- **THEN** the description has `limitsAvailable` false with a note, and no windows
- **AND** the billing mode is still reported when the runtime reported a subscription type

#### Scenario: A runtime with no plan limits

- **WHEN** the OpenCode adapter describes its account
- **THEN** the description has billing mode `metered_api`, `limitsAvailable` false, and a note
  saying OpenCode bills through provider keys and has no plan limits

#### Scenario: A runtime that only knows its billing mode

- **WHEN** the Codex or Gemini adapter describes an account
- **THEN** the description reports the billing mode it can determine from the credential the runtime
  home holds, `limitsAvailable` false, and a note naming what the CLI does not expose
- **AND** it reports no limit windows rather than windows at zero

#### Scenario: The runtime is not installed or does not answer

- **WHEN** describing an account fails, times out, or the runtime binary is missing
- **THEN** the failure SHALL NOT propagate to the caller as an error, and the account SHALL be
  reported as `unknown` billing with a note carrying the reason

### Requirement: The daemon keeps one current account snapshot per runtime

The system SHALL store, per workspace and runtime, the most recent account description together with
the time it was captured. A new snapshot SHALL replace the previous one for that workspace and
runtime; the system does not keep snapshot history.

The system SHALL refresh the snapshots on a recurring daemon poll without any user action, for every
runtime the workspace is spending on: the runtimes named by its two model settings, together with
the runtime of any agent that has not yet been retired, so that a worker still finishing a turn on a
runtime a setting has since moved away from is still accounted for. A refresh SHALL NOT block a run,
and a refresh that fails SHALL leave the previous snapshot in place and record the reason.

#### Scenario: The poll refreshes a snapshot

- **WHEN** the refresh interval has elapsed and a workspace has an agent configured on a runtime
- **THEN** that runtime's account is described again and the stored snapshot is replaced, with the
  capture time set to the moment it was captured

#### Scenario: A runtime nothing uses is not polled

- **WHEN** the refresh runs and a runtime is named by neither of the workspace's model settings and
  by no agent that is still live
- **THEN** that runtime is not described and no snapshot is written for it

#### Scenario: A refresh fails

- **WHEN** describing an account throws or times out during a refresh
- **THEN** the previously stored snapshot is left unchanged and the failure is logged, not surfaced
  as a daemon error

### Requirement: Usage records carry the account's billing type

When the system records a usage event for a run, it SHALL set the event's billing type from the
current account snapshot for that run's runtime, and `unknown` when there is no snapshot.

#### Scenario: A run on a subscription account

- **WHEN** a usage event is recorded for a run whose runtime's current snapshot says
  `subscription_included`
- **THEN** the stored usage event's billing type is `subscription_included`

#### Scenario: No snapshot yet

- **WHEN** a usage event is recorded for a run whose runtime has no snapshot
- **THEN** the stored usage event's billing type is `unknown` and the event is otherwise unchanged

### Requirement: The account snapshots are readable over the API

The system SHALL expose the current account snapshots for a workspace, each with its runtime id and
display name, billing mode, plan label, whether limits are available, its limit windows, its note,
and the time it was captured.

A usage series answer SHALL additionally report how the tokens in the queried scope and window split
across billing types, so a client can tell whether any metered spend occurred.

#### Scenario: Reading the snapshots

- **WHEN** a client requests the workspace's usage accounts
- **THEN** it receives one entry per runtime that has a snapshot, each with its capture time

#### Scenario: The billing mix of a window

- **WHEN** a client requests a usage series for a scope and window
- **THEN** the answer reports the token totals attributable to `subscription_included`,
  `metered_api` and `unknown` billing within that scope and window

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

### Requirement: The account probe launches the runtime CLI the way a turn does

A probe that spawns a coding CLI SHALL resolve that CLI and build its environment exactly as a turn
of the same runtime does. The child SHALL inherit the daemon's own environment, with the runtime
adapter's own values on top; it SHALL NOT be given an environment assembled only from what the
caller passed.

Resolving the CLI SHALL NOT depend on the environment of whatever shell started the daemon. A
command that does not already carry a path SHALL be looked for on the effective search path and
then in the directories the usual per-user installers place a CLI in, and SHALL be spawned by the
path it was found at. A command that carries a path SHALL be used as given, and a command that is
found nowhere SHALL be spawned unchanged, so that the failure is the runtime's own.

An account description that failed SHALL carry how the probe was launched — the command it
resolved, the working directory and the locations it searched — and the system SHALL log that,
with the reason, whenever a refresh produces an account it could not describe. That detail SHALL be
logged only: it is never stored with the snapshot and never shown to a human.

#### Scenario: The daemon's search path does not carry the CLI

- **WHEN** the account probe runs in a process whose search path does not contain the runtime CLI,
  and the CLI is installed where its installer puts it
- **THEN** the probe finds it, describes the account, and the snapshot carries the billing mode,
  the plan label and the limit windows

#### Scenario: A probe that could not launch the CLI

- **WHEN** a refresh produces an account the probe could not describe
- **THEN** the reason and the launch detail — the resolved command, the working directory and the
  locations searched — are logged as a warning
- **AND** neither reaches the stored snapshot beyond the note the description already carries

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
