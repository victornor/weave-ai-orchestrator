# conductor-chat/session-limit Specification

## Purpose
Puts the conductor's own plan usage and its context-window fullness in the chat header, next to
where the spending happens, reading live from the same runtime account snapshots the Usage page
already shows and refusing to draw a meter it cannot honestly measure.

## Requirements

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

The detail SHALL show the snapshot's age beside the numbers, worded as the time since the account
was last synced, and SHALL offer the same on-demand sync of the conductor's runtime that the usage
view offers, with the same in-flight, failed and refused-as-too-recent behaviour. A sync made from
the detail SHALL update the header meter as well, without a reload.

The header SHALL fit on a phone without wrapping onto a second line, and the detail SHALL be
reachable by tapping it there.

#### Scenario: Opening the detail

- **WHEN** the human activates the header meter
- **THEN** a detail opens listing every window the account reports, including the weekly and
  per-model windows, each with its utilisation and reset time, and the snapshot's age

#### Scenario: The header stays one line

- **WHEN** the chat is shown at a phone width
- **THEN** the meter is on the header's single line, and tapping it opens the detail

#### Scenario: Syncing from the detail

- **WHEN** the human uses the sync control in the detail
- **THEN** the conductor's runtime is synced on demand, and the detail and the header meter both
  show the returned snapshot without a reload

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
window is. The headline figure SHALL be the current context size itself — the raw token count — not
a percentage of the window: a percentage is only as trustworthy as its denominator, and the window a
model is declared to have can be wrong, so the count a human can check against reality SHALL lead. A
bar beside the count SHALL show the size as a proportion of the model's context window. Where the
runtime states a point at which it compacts the conversation, how far the size is towards that point
SHALL be shown as a percentage in words — the only percentage the header states.

The context size SHALL be the size of the **last API request** the conductor's most recent finished
turn made: the tokens that request sent, plus the tokens it read back from cache. It SHALL NOT be
the turn's total across its requests. A turn answers a prompt with as many requests as its tool use
needs, and each of them re-sends or cache-reads the whole conversation, so the total is roughly the
context size multiplied by the number of requests and is not a measurement of anything the window
holds. The header SHALL be updated when a conductor turn finishes, without a reload.

The size SHALL come from a figure the runtime itself reported for one request. The system SHALL
record it separately from the turn's cumulative token counts rather than replacing them: the
cumulative counts remain what cost, the usage records and the plan-limit strip are computed from,
and SHALL keep counting every request the turn made.

The context window SHALL come from the runtime's own model list, per model, so that a model variant
with a larger window is measured against its own. The compaction point SHALL come from the runtime's
own capabilities. Neither SHALL be stated by the client that draws the meter.

#### Scenario: A conductor turn on a 200k model

- **WHEN** the conductor's last finished turn ended with a request that sent 12k tokens and read 70k
  tokens from cache, on a model whose window is 200k, and the runtime compacts at 92 % of the window
- **THEN** the header's headline reads `82k`, with a bar drawn to 41 % of its width and `45%` to
  compaction shown in words
- **AND** hovering it shows `82k` of `200k` tokens

#### Scenario: A turn with many tool round-trips

- **WHEN** the conductor's last finished turn made twenty requests, each around 80k tokens of
  context, on a model whose window is 200k
- **THEN** the header measures one request, so the headline reads that request's own size, not a
  total built from all twenty
- **AND** the turn's usage record and its cost still account for every request's tokens, unchanged

#### Scenario: A model with a larger window

- **WHEN** the same turn ran on a model entry whose context window is 1M
- **THEN** the bar and the distance to compaction are computed against 1M, with no special case for
  the variant, while the headline count is unaffected by which window it is being measured against

#### Scenario: A runtime that does not compact

- **WHEN** the conductor's runtime states no compaction point
- **THEN** the header shows the headline count and the bar, and omits the distance to compaction

#### Scenario: A turn finishes

- **WHEN** a conductor turn finishes while the chat is open
- **THEN** the context meter is recomputed from that turn without a reload

### Requirement: A context the header cannot honestly measure is not drawn

The header SHALL NOT show a context percentage, or a bar, it had to invent a number for.

Where the conductor has not finished a turn, the header SHALL show nothing about context: there is
nothing to measure, and that is not a failure to report.

Where the conductor has run and a per-request context size was reported for that turn, but the model
it ran on is not one the runtime's model list states a context window for, the header SHALL still
show the headline count — the size itself is known even though the window is not — with no bar and
no percentage in words, rather than falling back to a quiet line that would bury a number the human
most wants to see exactly when the denominator cannot be trusted.

Where no per-request context size was reported for that turn at all — because the turn reported no
usable token counts, or because its runtime reports only totals across the requests it made — the
header SHALL show a single quiet line saying so, since there is no size to fall back to either. A
runtime that cannot report per request SHALL NOT have its cumulative totals shown as a context size
instead.

#### Scenario: No finished turn yet

- **WHEN** the conductor has never finished a turn
- **THEN** the header shows nothing about context

#### Scenario: A model the runtime states no window for

- **WHEN** the conductor's last turn ran on a model that is not in the runtime's model list, or on
  one whose entry carries no context window, but the turn did report a per-request context size
- **THEN** the header shows that size as its headline, with no bar and no percentage

#### Scenario: A turn that reported no tokens

- **WHEN** the conductor's last finished turn reported no per-request context size
- **THEN** the header says the context size was not reported, distinctly from the window being
  unknown, and shows no headline count, no percentage and no bar

#### Scenario: A runtime that reports only cumulative usage

- **WHEN** the conductor is on a runtime whose turns report only the totals across every request
  they made, and its last turn recorded such a total
- **THEN** the header says the context size was not reported, and shows no headline count, no
  percentage and no bar, rather than measuring the total against the window

### Requirement: A context larger than its declared window is shown as anomalous, not clamped

Where the measured context size is larger than the context window declared for the model the turn
ran on, the header SHALL treat that as evidence the declared window is wrong, not as a context that
has simply filled it. The distance to compaction — the one percentage the header states in words —
SHALL be shown as its true, uncapped value, past 100 %, rather than clamped to the same reading a
context that has genuinely filled its window at exactly 100 % would produce. The two SHALL be
distinguishable: a clamped-looking 100 % SHALL NOT be the only way to read either "compaction is
imminent" or "the declared window is wrong." The headline count itself is unaffected — it is not a
fraction of anything, so it cannot go anomalous the way a percentage can, and stays trustworthy
exactly when the percentage beside it is signalling that something else is not.

The meter's bar SHALL stop filling at the edge of its own drawn space regardless of how far past
100 % the true underlying proportion is — a bar cannot be drawn wider than the space it has.

#### Scenario: A measured context that has outgrown its declared window

- **WHEN** the conductor's last finished turn's context size is larger than the declared context
  window of the model it ran on, and the runtime states a compaction point
- **THEN** the header's headline count is shown as usual
- **AND** the distance to compaction is shown past 100 %, not clamped to 100 %

#### Scenario: The bar does not overflow its own space

- **WHEN** the underlying proportion exceeds 100 %
- **THEN** the meter's bar is drawn at its full width and no further
- **AND** the distance to compaction beside it keeps showing the true, uncapped number

### Requirement: OpenCode records last-request context size

When the OpenCode adapter finishes a turn whose JSON stream reported a `tokens` object on one
or more `step_finish` events, the turn result's `usage.contextTokens` SHALL be the size of the
**last** such request: that request's input tokens plus its cache-write tokens plus its
cache-read tokens. It SHALL NOT be the sum of those fields across the turn's requests, and it
SHALL NOT be the stream's `tokens.total` (which includes output). Cumulative `inputTokens` /
`outputTokens` / `cachedInputTokens` SHALL keep summing every request the turn made.

When no `step_finish` carried a `tokens` object, `contextTokens` SHALL be omitted. The adapter
SHALL NOT substitute the cumulative totals.

The existing conductor-chat context meter already reads only `usage.contextTokens`. Once this
field is set, a finished OpenCode conductor turn SHALL show a size (and a window, when the
runtime declares one) rather than "Context size unreported".

#### Scenario: An OpenCode turn with two steps

- **WHEN** an OpenCode turn's stream reports tokens on two `step_finish` events, the first
  `input` 4294 / `cache.write` 0 / `cache.read` 7424 and the second `input` 257 /
  `cache.write` 0 / `cache.read` 11520
- **THEN** `usage.contextTokens` is 11777, the last request's size
- **AND** the cumulative `inputTokens` and `cachedInputTokens` still account for both steps

#### Scenario: An OpenCode turn with no token figures

- **WHEN** an OpenCode turn's stream has no `step_finish` `tokens` object
- **THEN** `usage.contextTokens` is omitted
- **AND** the context meter shows that the size was not reported, rather than measuring any
  cumulative total against the window
