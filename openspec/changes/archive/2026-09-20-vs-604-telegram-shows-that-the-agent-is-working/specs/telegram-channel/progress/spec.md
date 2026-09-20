# telegram-channel/progress Specification

## Purpose

Defines how the Telegram channel shows that an agent is working: a typing action kept alive for the length of
a turn and one placeholder message edited in place as the turn moves, removed once the final answer has been
sent as a new message (an edit would raise no notification) or when no answer follows — without a second
progress message and without failing the turn on an API error.

## ADDED Requirements

### Requirement: The typing action is kept alive for the turn

While a turn is live, the Telegram channel SHALL send the `typing` chat action repeatedly, each send no longer
than the action's lifetime (about 5 s), and SHALL stop sending it when the turn ends. A send failure SHALL be
logged and SHALL NOT stop the refresh or fail the turn.

#### Scenario: A twelve-second turn looks alive

- **WHEN** a turn runs for 12 s with progress `start` and no later state change reaching the adapter
- **THEN** `sendChatAction typing` has been sent at least twice more before the turn ends, well inside each action's expiry

#### Scenario: Typing stops at turn end

- **WHEN** the daemon calls `progress('end')`
- **THEN** no further typing action is sent for that turn

### Requirement: One placeholder message, edited in place

On `progress('start')` the channel SHALL send exactly one placeholder text message and remember its id. On
`progress('update')` it SHALL edit that same message with `editMessageText` and SHALL NOT send a second
progress message for the turn. Edits SHALL be coalesced to no more than about one every 3 s, the newest text
winning when a later update arrives first.

#### Scenario: Several updates inside one edit window

- **WHEN** three `update` calls arrive within 3 s
- **THEN** at most one `editMessageText` is issued in that window and no additional message is sent

### Requirement: Rate limiting is honoured without failing the turn

When `editMessageText` is answered with HTTP 429 carrying `retry_after`, the channel SHALL NOT attempt another
edit before that many seconds have passed, SHALL keep the newest pending text, and SHALL NOT fail the turn.
The next allowed edit SHALL carry that newest text.

#### Scenario: A 429 with retry_after reschedules

- **WHEN** an edit is answered `429` with `retry_after: 5`
- **THEN** no edit is attempted for the next 5 s, the turn continues, and the first edit after that carries the newest progress text

### Requirement: The answer is always a new message, and the placeholder is removed after it

The final answer SHALL be delivered through the normal send path as a new message and SHALL NEVER be delivered
by editing the placeholder, because Telegram raises no push notification or sound for an edited message and
the human must be alerted that the agent has answered. After a delivered answer the channel SHALL remove the
placeholder with `deleteMessage`, best effort, whatever the answer's shape — a single text message, a card, an
attachment or a split message. If the turn ends and no answer follows within a bounded grace period, the
placeholder SHALL be deleted. Once the answer is being sent, the placeholder's typing and edits SHALL stop and
any later `progress` for that turn SHALL be ignored.

#### Scenario: The answer is a new message, then the placeholder is deleted

- **WHEN** the turn's final answer is a single text message and a placeholder exists for that thread
- **THEN** the answer is delivered with `sendMessage`, no `editMessageText` is issued for it, and the placeholder is deleted after it

#### Scenario: A non-text answer still removes the placeholder

- **WHEN** the turn's final answer is a card, an attachment or a split message
- **THEN** it is sent through the normal path and the placeholder is deleted after it

#### Scenario: No answer follows

- **WHEN** a turn ends, no outbound answer is delivered to the thread, and the grace period passes
- **THEN** the placeholder message is deleted

#### Scenario: A late update after the answer

- **WHEN** a `progress('update')` arrives after the answer has been sent
- **THEN** no new placeholder is sent and no edit is made

### Requirement: Progress failures never fail the turn

A failure of any Bot API call made for progress (`sendChatAction`, `sendMessage`, `editMessageText`,
`deleteMessage`) SHALL be logged and swallowed. It SHALL never propagate to the run or to outbound message
delivery.

#### Scenario: Telegram is unreachable

- **WHEN** every progress call fails with a network error
- **THEN** the run completes and the run's final outbound message is still attempted through the normal send path
