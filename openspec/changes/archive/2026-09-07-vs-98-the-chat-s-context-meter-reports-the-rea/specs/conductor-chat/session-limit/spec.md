## MODIFIED Requirements

### Requirement: The header meters how full the conductor's context is

The conductor chat's header SHALL show, beside the plan meter, how full the conductor's context
window is: the current context size as a percentage of the model's context window, and — where the
runtime states a point at which it compacts the conversation — how far that size is towards that
point, as a percentage of it. The absolute token count SHALL be available without taking header
space.

The context size SHALL be the size of the **last API request** the conductor's most recent finished
turn made: the tokens that request sent, plus the tokens it read back from cache. It SHALL NOT be
the turn's total across its requests. A turn answers a prompt with as many requests as its tool use
needs, and each of them re-sends or cache-reads the whole conversation, so the total is roughly the
context size multiplied by the number of requests and is not a measurement of anything the window
holds. The number SHALL be updated when a conductor turn finishes, without a reload.

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
- **THEN** the header shows the context at `41%` of the window and `45%` of the way to compaction
- **AND** hovering it shows `82k` of `200k` tokens

#### Scenario: A turn with many tool round-trips

- **WHEN** the conductor's last finished turn made twenty requests, each around 80k tokens of
  context, on a model whose window is 200k
- **THEN** the header measures one request, so the meter shows roughly 40 % and cannot exceed 100 %
- **AND** the turn's usage record and its cost still account for every request's tokens, unchanged

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

Where the conductor has run but no per-request context size was reported for that turn — because the
turn reported no usable token counts at all, or because its runtime reports only totals across the
requests it made — or where the model it ran on is not one the runtime's model list states a context
window for, the header SHALL show a single quiet line saying which of those happened, and no
percentage and no bar. A missing size and an unknown window SHALL be distinguishable. A runtime that
cannot report per request SHALL NOT have its cumulative totals shown as a context size instead.

#### Scenario: No finished turn yet

- **WHEN** the conductor has never finished a turn
- **THEN** the header shows nothing about context

#### Scenario: A model the runtime states no window for

- **WHEN** the conductor's last turn ran on a model that is not in the runtime's model list, or on
  one whose entry carries no context window
- **THEN** the header says the context window is unknown, and shows no percentage and no bar

#### Scenario: A turn that reported no tokens

- **WHEN** the conductor's last finished turn reported no per-request context size
- **THEN** the header says the context size was not reported, distinctly from the window being
  unknown, and shows no percentage and no bar

#### Scenario: A runtime that reports only cumulative usage

- **WHEN** the conductor is on a runtime whose turns report only the totals across every request
  they made, and its last turn recorded such a total
- **THEN** the header says the context size was not reported, and shows no percentage and no bar,
  rather than measuring the total against the window
