## MODIFIED Requirements

### Requirement: A worker the system will not retry itself is put to the human

When a worker's run fails and the system will not attempt it again by itself — because the automatic
attempts are spent, because the failure is not retryable, or because the runtime reported a usage
limit, which is never retried automatically — the system SHALL stop and SHALL raise a decision owned
by the human, attached to the worker's ticket, naming the worker and what it failed on.

A failure to authenticate SHALL be the one exception: it is not a fact about this worker but about
the credential the whole runtime shares, so the system SHALL NOT park the worker for the human and
SHALL NOT raise this per-worker decision for it. Such a failure SHALL stop the runtime and be
handled once for the runtime instead.

The decision SHALL name the family of the failure and the runtime's own message. When a trustworthy
reset time can be read from that message, the decision SHALL say when the limit resets and SHALL
recommend retrying after that moment. A timestamp that cannot be parsed, that is already in the
past, or that sits beyond the bound below SHALL be treated as unknown, and the decision SHALL then
recommend retrying later as it does today. The system SHALL NOT invent a reset time, and SHALL NOT
assume a naive clock is UTC.

The bound SHALL be the window length named in the same message, plus a two-minute slack, when the
message names one. When it does not, the bound SHALL be fourteen days. `now` SHALL be the instant
the run failed, not the start of the named window. A naive timestamp SHALL be interpreted through
whole-hour offsets; the system SHALL keep each such instant that is after now and not beyond the
bound, and when more than one survives it SHALL take the earliest. A timestamp that already names
an offset SHALL NOT be re-zoned.

The decision SHALL offer retrying now and cancelling the ticket. When a reset time is known it SHALL
additionally offer retrying automatically at that reset time; otherwise it SHALL offer retrying later.
It SHALL NOT offer running the worker on another runtime as a workspace-setting change: the runtime
is a setting of the workspace and not of a worker. Where the failure was a usage limit, the decision
SHALL still say which setting holds the runtime, and it SHALL also offer each other configured
worker-model catalog option as an answer, so the human can continue this ticket on a different
option. It SHALL NOT recommend a catalog switch. It SHALL NOT offer a catalog option the ticket is
already on. When the catalog is empty, or the ticket is already on the only option, it SHALL offer
no switch. For any failure that is not a usage limit, it SHALL NOT offer a catalog switch.

Taking a catalog-switch answer SHALL keep the ticket's existing worktree, branch and commits, and
SHALL use the chosen option for the next turn. The system SHALL NOT start any attempt, and SHALL NOT
change the ticket's worker-model option, unless the human has chosen that answer: until the decision
is answered the worker stays parked and nothing further is spent on it.

The worker SHALL be paused with a reason that names the failure, and the ticket SHALL be moved to
`blocked` unless it has already reached a state in which no further work is expected.

The system SHALL raise at most one such open decision per worker: a second failure while one is
still open SHALL supersede it rather than adding a second card.

This requirement governs what happens once the system will not retry on its own. It does not change
how many automatic attempts there are, how long they wait, or which failures are retried.

#### Scenario: The retries are spent

- **WHEN** a worker's last automatic retry fails
- **THEN** a decision owned by the human is raised on that worker's ticket, offering retry, retry
  later, and cancel, and no option naming another runtime
- **AND** the decision appears in the human's list of open decisions
- **AND** the worker is paused and the ticket is `blocked`

#### Scenario: A usage limit parks on the first failure

- **WHEN** a worker's turn fails because its runtime reported a usage limit
- **THEN** the worker is parked on that first failure with no automatic attempt having been made
- **AND** the decision names the quota family and the runtime's message
- **AND** the decision says that the runtime is the workspace's workers setting

#### Scenario: A known reset time is offered, not booked

- **WHEN** a worker is parked because its runtime reported a usage limit and said when it resets
- **THEN** the decision says when the limit resets and offers retrying automatically at that time
- **AND** the recommended answer is that reset-time retry, not retrying in an hour
- **AND** no attempt is scheduled unless the human chooses that option

#### Scenario: An unanswered card spends nothing

- **WHEN** a parked worker's decision is left unanswered
- **THEN** no turn is started for that worker

#### Scenario: A second failure while the card is open

- **WHEN** a worker that already has an open parking decision fails again
- **THEN** the earlier decision is superseded and the human is left with exactly one open card for
  that worker

#### Scenario: An authentication failure does not park the worker

- **WHEN** a worker's turn fails because the runtime could not authenticate
- **THEN** no per-worker decision is raised for it and the worker's ticket is not blocked for it
- **AND** the runtime is stopped and one decision is raised for the runtime instead

#### Scenario: An unreadable reset time keeps today's hour offer

- **WHEN** a worker is parked because its runtime reported a usage limit whose message has no
  parseable reset time, or names a time that is already past, more than fourteen days ahead when no
  window is named, or beyond the named window with no whole-hour offset that lands after now and
  within that window
- **THEN** the decision offers retrying later rather than retrying at a reset time
- **AND** the recommended answer is that later retry

#### Scenario: A naive clock beyond the named window is reconciled to that window

- **WHEN** a worker is parked because its runtime reported a usage limit whose message names a
  five-hour window and a naive reset clock `2026-09-12 01:54:35`, and that failure's `now` is
  `2026-09-11T17:00:12Z`
- **THEN** the decision's recommended retry is at `2026-09-11T17:54:35.000Z`
- **AND** it is not at `2026-09-12T01:54:35.000Z`

#### Scenario: A usage-limit card offers other catalog options

- **WHEN** a worker is parked because its runtime reported a usage limit and the workspace has at
  least one worker-model catalog option the ticket is not already on
- **THEN** the decision offers each of those other options as an answer, alongside retry, the
  deferred retry, and cancel
- **AND** none of those switch answers is the recommended answer

#### Scenario: Taking a catalog switch keeps the worktree

- **WHEN** the human answers a usage-limit parking decision by choosing another catalog option
- **THEN** the ticket's stored worker-model option becomes that id
- **AND** the same worktree, branch and commits remain
- **AND** the worker is resumed so its next turn uses that option

#### Scenario: No catalog switch happens without a human answer

- **WHEN** a worker is parked because its runtime reported a usage limit and the human has not
  answered the decision
- **THEN** the ticket's stored worker-model option is unchanged
- **AND** no turn is started for that worker

### Requirement: The stored failure message preserves the runtime's text, and marks it instead of cutting it silently

When the system captures the runtime's own failure message for a worker's pause detail and for the
decision it raises, it SHALL preserve that message in full up to a generous limit. When the message
is longer than that limit, the stored text SHALL end with a visible marker stating that text was cut,
so the marker travels with the stored message itself and every reader of it — the decision card, the
worker's pause detail, any other surface that reads the same field — sees the same honest signal
rather than a message that merely stops.

Classifying the failure into a family SHALL NOT replace those words with a generic family label. A
usage-limit message that names when the limit resets SHALL still contain those words after it is
stored, so the reset time can be read from what the human and the parser both see.

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

#### Scenario: A usage-limit message keeps the provider's reset words

- **WHEN** a worker's runtime reports a usage limit whose own text names when the limit resets
- **THEN** the decision's stored message and the worker's pause detail both contain those words
- **AND** they do not replace that text with a generic family label
