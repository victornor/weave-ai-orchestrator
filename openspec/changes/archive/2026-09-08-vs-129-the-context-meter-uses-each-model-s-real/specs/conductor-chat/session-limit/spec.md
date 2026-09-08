## MODIFIED Requirements

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

## ADDED Requirements

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
