## ADDED Requirements

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
