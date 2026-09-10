## ADDED Requirements

### Requirement: The stored failure message preserves the runtime's text, and marks it instead of cutting it silently

When the system captures the runtime's own failure message for a worker's pause detail and for the
decision it raises, it SHALL preserve that message in full up to a generous limit. When the message
is longer than that limit, the stored text SHALL end with a visible marker stating that text was cut,
so the marker travels with the stored message itself and every reader of it — the decision card, the
worker's pause detail, any other surface that reads the same field — sees the same honest signal
rather than a message that merely stops.

This requirement governs what is captured and stored. How a view presents that stored text — inline,
collapsed with an expand control, or capped further for a compact preview — does not change what was
kept; it is governed separately.

#### Scenario: A long, structured failure message survives intact

- **WHEN** a worker's runtime fails with a message that includes a trailing list of many items, such
  as a comma-separated list of valid values, and that message is within the generous limit
- **THEN** the decision raised for the worker, and the worker's own pause detail, both contain the
  message in full, including its last item

#### Scenario: A message longer than the limit is marked, not cut silently

- **WHEN** a worker's runtime failure message is longer than the generous limit
- **THEN** the stored message ends with a visible marker stating that text was cut, and that marker is
  part of the stored text itself

#### Scenario: A short message is unaffected

- **WHEN** a worker's runtime failure message is well within the generous limit
- **THEN** it is stored exactly as the runtime reported it, with no marker appended
