## Purpose

Makes a bounded `ticket_comment` wake payload honest about being a fragment, so a worker reading a
long human comment knows it was cut, how long the original was, and which tool returns the rest —
rather than acting on the first 500 characters believing it has the whole comment.

## ADDED Requirements

### Requirement: A truncated ticket-comment wake payload states that it was cut

When a human comment's body exceeds the `ticket_comment` wake payload's character bound, every wake
payload that carries that comment SHALL include `truncated: true` and `bodyLength` set to the
original comment's character count, alongside the truncated `body` field. This SHALL hold both for
the direct wake to a live worker and for the follow-up payload delivered when the ticket has no live
worker, whether that payload wakes an existing worker or a newly spawned one.

#### Scenario: An over-bound comment wakes a live worker with the marker

- **WHEN** a human comments on a ticket that has a live worker, with a body longer than the wake
  payload's character bound
- **THEN** the `ticket_comment` wake payload has `truncated: true` and `bodyLength` equal to the full
  comment's character count, alongside a `body` truncated to the bound

#### Scenario: An over-bound comment on a workerless ticket still carries the marker

- **WHEN** a human comments on a ticket that has no live worker, with a body longer than the wake
  payload's character bound, and the follow-up path delivers that comment to an existing or a newly
  spawned worker
- **THEN** the `ticket_comment` wake payload the worker receives has `truncated: true` and
  `bodyLength` equal to the full comment's character count

#### Scenario: A long comment reproduces the marker

- **WHEN** a human posts a 9,000-character comment to a worker's ticket
- **THEN** the wake payload's `body` is truncated to the bound, `truncated` is `true`, and
  `bodyLength` is `9000`

### Requirement: A comment within the bound carries no truncation fields

When a human comment's body is at or under the `ticket_comment` wake payload's character bound, every
wake payload that carries it SHALL carry the full body unchanged and SHALL NOT include a `truncated`
field or a `bodyLength` field.

#### Scenario: A short comment is unaffected

- **WHEN** a human comments on a worker's ticket with a body at or under the wake payload's character
  bound
- **THEN** the wake payload's `body` equals the comment exactly, and the payload has no `truncated`
  field and no `bodyLength` field

### Requirement: A reader of a truncated comment wake is pointed at the full comment

When a `ticket_comment` wake payload was truncated, the wake's reason line SHALL name
`ac_ticket_comments` as the tool that returns the full comment body, so a worker holding a fragment
knows to fetch the rest. The tool already returns full comment bodies and its behavior is unchanged.

#### Scenario: The reason points at the read tool

- **WHEN** a worker is woken by a `ticket_comment` wake whose payload was truncated
- **THEN** the wake's reason line names `ac_ticket_comments`

#### Scenario: An untruncated wake reason is unchanged

- **WHEN** a worker is woken by a `ticket_comment` wake whose payload was not truncated
- **THEN** the wake's reason line does not mention `ac_ticket_comments`

### Requirement: A follow-up's embedded comment excerpt is marked rather than cut silently

When the follow-up path embeds a comment in prose — the relaunch note given to an existing worker, and
the no-role wake reason given to the conductor — and the comment is longer than that prose excerpt,
the excerpt SHALL be followed by an explicit truncation marker that names `ac_ticket_comments`,
rather than ending silently. When the comment fits the excerpt, the prose SHALL be unchanged.

#### Scenario: The relaunch note marks a truncated excerpt

- **WHEN** a human replies to a ticket whose worker is parked or failed, with a comment longer than
  the relaunch note's excerpt
- **THEN** the relaunch note contains a truncation marker naming `ac_ticket_comments`

#### Scenario: The no-role wake reason marks a truncated excerpt

- **WHEN** a human replies to a ticket that has no role, with a comment longer than the no-role wake
  reason's excerpt
- **THEN** that reason contains a truncation marker naming `ac_ticket_comments`

#### Scenario: A short reply leaves the prose unchanged

- **WHEN** a human replies with a comment that fits within the excerpt
- **THEN** the relaunch note and the no-role reason contain the comment without a truncation marker
