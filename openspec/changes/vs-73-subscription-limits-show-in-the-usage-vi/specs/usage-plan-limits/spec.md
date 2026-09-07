## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: The usage view leads with plan limits on subscription accounts

When every token in the queried scope and window was billed as `subscription_included`, the usage
view SHALL show the plan limits and SHALL NOT show a dollar figure for that window. Otherwise it
SHALL show dollar cost exactly as it does when no snapshot exists, and where that window contains
both subscription usage and metered or unclassified usage the view SHALL say that this is why the
cost is still shown.

Where limits are shown, the view SHALL show the plan label, each limit window with its utilisation
and its reset time, and how long ago the snapshot was captured. Where an account reports no limits,
the view SHALL say the limits are unavailable, with the account's note, and SHALL NOT draw a zero.

Where the account could not be described at all, the view SHALL say that the probe failed rather
than that the plan has no limits, and SHALL show the account's note and the capture time.

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
