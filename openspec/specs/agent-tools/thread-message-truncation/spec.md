# agent-tools/thread-message-truncation Specification

## Purpose
Makes a bounded `human_message` wake payload honest about being a fragment, and gives the conductor
a supported way to read the rest, so a long message is never silently reviewed as if it were the
whole thing.

## Requirements

### Requirement: A truncated human-message wake payload states that it was cut

When an inbound human message's body exceeds the wake payload's character bound, the
`human_message` wake's payload SHALL include `truncated: true` and `bodyLength` set to the original
message's character count, alongside the truncated `body` field.

#### Scenario: A message over the bound is marked truncated

- **WHEN** a human sends a message whose body is longer than the wake payload's character bound
- **THEN** the resulting `human_message` wake payload has `truncated: true` and `bodyLength` equal
  to the full message's character count

#### Scenario: An 11,064-character message reproduces the marker

- **WHEN** a human sends an 11,064-character message
- **THEN** the wake payload's `body` is truncated to the bound, `truncated` is `true`, and
  `bodyLength` is `11064`

### Requirement: A message within the bound carries no truncation fields

When an inbound human message's body is at or under the wake payload's character bound, the
`human_message` wake payload SHALL carry the full body unchanged and SHALL NOT include a
`truncated` field or a `bodyLength` field.

#### Scenario: A short message is unaffected

- **WHEN** a human sends a message whose body is at or under the wake payload's character bound
- **THEN** the wake payload's `body` equals the message exactly, and the payload has no `truncated`
  field and no `bodyLength` field

### Requirement: A thread message's full body is retrievable by id without reading the database

`ThreadsService` SHALL expose a read for one thread message by id, scoped to the thread it belongs
to the same way attachment reads are: a message id that exists under a different thread SHALL be
reported `not_found`, identically to a message id that does not exist at all. This read SHALL be
exposed to the conductor as an MCP tool and SHALL return the message's full stored `body`,
regardless of whether the wake payload that referenced it was truncated.

#### Scenario: Reading the full body of a truncated message

- **WHEN** the conductor calls the thread-message read tool with the `threadId` and `messageId`
  from a truncated `human_message` wake payload
- **THEN** the response's `body` is the complete original message, not the truncated fragment

#### Scenario: A message id from another thread is not found

- **WHEN** the thread-message read tool is called with a `messageId` that belongs to a thread other
  than the given `threadId`
- **THEN** the call fails with `not_found`, the same response as an unknown `messageId`
