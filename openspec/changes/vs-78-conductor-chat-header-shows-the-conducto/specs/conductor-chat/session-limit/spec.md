## ADDED Requirements

### Requirement: The conductor chat header meters the conductor's plan

When the conductor's runtime has an account snapshot that is not billed per token and reports at
least one plan limit window, the conductor chat's page header SHALL show a meter for that account:
the window's label, its utilisation as a whole percentage, a bar of that width, and the time left
before it resets.

The window shown SHALL be the rolling session window when the runtime reports one, and otherwise
the first window the runtime does report — that is still the limit the human is spending against.
The utilisation SHALL be clamped to 0..100. The bar SHALL change tone past 80 % and again past
95 %, on the same thresholds the usage view's plan bars use.

The time left SHALL be written at a granularity a header can carry and a human can act on: minutes
inside the hour, hours and minutes inside the day, days and hours beyond it. A window whose reset
time the runtime does not report SHALL show the meter without a countdown rather than no meter.

#### Scenario: The conductor is on a subscription

- **WHEN** the conductor chat loads and the conductor's runtime has a subscription snapshot whose
  session window is at 33 % and resets in two hours and ten minutes
- **THEN** the header shows that window's label, `33%`, a bar a third of its width, and `2h 10m`

#### Scenario: The runtime reports no session window

- **WHEN** the conductor's runtime reports plan windows but none of them is the session window
- **THEN** the header meters the first window the runtime reports, with its own label

#### Scenario: A window with no reset time

- **WHEN** the metered window carries no reset time
- **THEN** the header shows the label and the percentage and omits the countdown

### Requirement: The meter is the conductor's own runtime

The header meter SHALL be about the runtime the conductor itself runs on, and SHALL ignore snapshots
for every other runtime in the workspace, including the runtimes its workers use. The runtime SHALL
be read from the single place the rest of the app reads it from, so that the header and the
conductor's own settings can never disagree about which runtime it is.

#### Scenario: Workers on another runtime

- **WHEN** the workspace has snapshots for the conductor's runtime and for a different runtime its
  workers use
- **THEN** the header meters only the conductor's runtime

#### Scenario: The conductor's runtime is changed

- **WHEN** the conductor's runtime is changed to another runtime that has a snapshot
- **THEN** the header meters the new runtime's account

### Requirement: The meter stays live without a reload

The header SHALL re-read the account snapshots on the same cadence the daemon refreshes them, and
SHALL count the reset down locally between those refreshes, so the time left decreases while the
page is simply left open. A refresh that returns the same snapshot SHALL NOT reset the countdown.

The header SHALL make the capture time of the snapshot it is showing available without taking
header space, so that a snapshot which has not been refreshed reads as old rather than as current.

#### Scenario: The countdown between refreshes

- **WHEN** the chat is left open and no new snapshot has arrived
- **THEN** the time left before the reset decreases as real time passes, without a reload

#### Scenario: The countdown reaches the reset

- **WHEN** the reset time is reached or has passed and no new snapshot has arrived
- **THEN** the header says the window is resetting now rather than showing a negative time

#### Scenario: Seeing how old the number is

- **WHEN** the human hovers the meter
- **THEN** the runtime, the plan label and how long ago the snapshot was captured are shown

### Requirement: The other windows are one interaction away

The weekly window and any per-model windows the account reports SHALL be reachable from the header
without occupying it: activating the meter SHALL open a detail showing the plan label, every window
the account reports with its utilisation and its reset time, and the snapshot's age. The detail
SHALL present those windows exactly as the usage view presents them.

The header SHALL fit on a phone without wrapping onto a second line, and the detail SHALL be
reachable by tapping it there.

#### Scenario: Opening the detail

- **WHEN** the human activates the header meter
- **THEN** a detail opens listing every window the account reports, including the weekly and
  per-model windows, each with its utilisation and reset time, and the snapshot's age

#### Scenario: The header stays one line

- **WHEN** the chat is shown at a phone width
- **THEN** the meter is on the header's single line, and tapping it opens the detail

### Requirement: A plan the header cannot honestly meter is not drawn

The header SHALL NOT render a meter, a percentage or a bar for an account it has no plan window for.

Where the conductor's runtime is billed per token, or has no snapshot at all, the header SHALL show
nothing about plan limits: neither has a plan window to be a fraction of, and an empty header is
correct where a zero would not be.

Where the account is a subscription whose limit windows the runtime could not report, or an account
the probe could not describe at all, the header SHALL show a single quiet line saying which of those
happened, and no number. The two SHALL be distinguishable: a failed probe SHALL NOT read as a plan
that happens to have no limits.

#### Scenario: A metered account

- **WHEN** the conductor's runtime snapshot is billed per token
- **THEN** the header shows nothing about plan limits

#### Scenario: No snapshot yet

- **WHEN** the conductor's runtime has not been probed yet
- **THEN** the header shows nothing about plan limits

#### Scenario: A subscription with no windows

- **WHEN** the conductor's runtime is a subscription whose snapshot reports no limit windows
- **THEN** the header says the limits are unavailable, and shows no percentage and no bar

#### Scenario: A probe that failed

- **WHEN** the conductor's runtime snapshot is one the probe could not describe
- **THEN** the header says the account probe failed, distinctly from limits being unavailable, and
  shows no percentage and no bar

### Requirement: The header meters how full the conductor's context is

The conductor chat's header SHALL show, beside the plan meter, how full the conductor's context
window is: the current context size as a percentage of the model's context window, and — where the
runtime states a point at which it compacts the conversation — how far that size is towards that
point, as a percentage of it. The absolute token count SHALL be available without taking header
space.

The context size SHALL be the conductor's most recent finished turn's input tokens plus its
cache-read tokens, which is what a resumed session re-sends or reads back each turn. The number
SHALL be updated when a conductor turn finishes, without a reload.

The context window SHALL come from the runtime's own model list, per model, so that a model variant
with a larger window is measured against its own. The compaction point SHALL come from the runtime's
own capabilities. Neither SHALL be stated by the client that draws the meter.

#### Scenario: A conductor turn on a 200k model

- **WHEN** the conductor's last finished turn reported 12k input tokens and 70k cache-read tokens on
  a model whose window is 200k, and the runtime compacts at 92 % of the window
- **THEN** the header shows the context at `41%` of the window and `45%` of the way to compaction
- **AND** hovering it shows `82k` of `200k` tokens

#### Scenario: A model with a larger window

- **WHEN** the same turn ran on a model entry whose context window is 1M
- **THEN** the percentage is computed against 1M, with no special case for the variant

#### Scenario: A runtime that does not compact

- **WHEN** the conductor's runtime states no compaction point
- **THEN** the header shows the percentage of the window and omits the distance to compaction

#### Scenario: A turn finishes

- **WHEN** a conductor turn finishes while the chat is open
- **THEN** the context meter is recomputed from that turn without a reload

### Requirement: A context the header cannot honestly measure is not drawn

The header SHALL NOT show a context percentage it had to invent a number for.

Where the conductor has not finished a turn, the header SHALL show nothing about context: there is
nothing to measure, and that is not a failure to report.

Where the conductor has run but the turn reported no usable token counts, or where the model it ran
on is not one the runtime's model list states a context window for, the header SHALL show a single
quiet line saying which of those happened, and no percentage and no bar. The two SHALL be
distinguishable.

#### Scenario: No finished turn yet

- **WHEN** the conductor has never finished a turn
- **THEN** the header shows nothing about context

#### Scenario: A model the runtime states no window for

- **WHEN** the conductor's last turn ran on a model that is not in the runtime's model list, or on
  one whose entry carries no context window
- **THEN** the header says the context window is unknown, and shows no percentage and no bar

#### Scenario: A turn that reported no tokens

- **WHEN** the conductor's last finished turn reported no input or cache-read tokens
- **THEN** the header says the context size was not reported, distinctly from the window being
  unknown, and shows no percentage and no bar
