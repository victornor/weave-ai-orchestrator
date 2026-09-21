## ADDED Requirements

### Requirement: A ticket chip expands in place to the ticket's live feed

Each ticket chip in a weaver message's strip SHALL carry its own expand control, separate from the
chip's open-ticket action: an independent hit target whose `aria-expanded` reflects the panel's
state, carrying a label that names the ticket ("Show live status of `<identifier>`" / "Hide live
status of `<identifier>`") and reachable by keyboard. Activating the chip body SHALL open the ticket
through the chat's one shared ticket link handler as before, and SHALL NOT toggle the panel.

While a chip is expanded the conductor chat SHALL render that ticket's live feed under the chip row
by reusing the one activity-feed component the ticket modal renders — not a second view — and SHALL
pass it the same shared link handler the message body uses, so a ticket reference the feed renders as
a link activates identically. The feed SHALL mount, and subscribe to anything extra, only while its
chip is expanded; a message whose chips are all collapsed SHALL mount no feed and open no additional
connection.

The open state SHALL be per chip in the current view: several chips in one message MAY be expanded at
once, and the state SHALL NOT persist across a reload. While expanded, the panel SHALL stay live from
the ticket, comment and run queries and the event stream the chat already has open, with no new poll
and no second connection.

When an expanded chip's ticket reaches a terminal state (`done` or `cancelled`) while the panel is
open, the panel SHALL collapse on its own and the chip SHALL keep showing the final status. A ticket
that is already terminal when expanded SHALL NOT auto-collapse, and a ticket that is in review,
needing the human or blocked SHALL NOT auto-collapse.

#### Scenario: The expand control is separate from the chip body

- **WHEN** the human activates the expand control on a chip
- **THEN** the inline panel toggles and the ticket modal does not open, while activating the chip
  body still opens the ticket and does not toggle the panel

#### Scenario: The state is announced

- **WHEN** a chip's panel is opened and then closed
- **THEN** the expand control's `aria-expanded` is true while open and false when closed, and its
  label names the ticket and the action available

#### Scenario: Several chips expanded at once

- **WHEN** the human expands two chips in one message
- **THEN** both panels render at the same time, each independently collapsible

#### Scenario: A terminal transition collapses the panel

- **WHEN** an expanded chip's ticket moves to `done` or `cancelled` while the panel is open
- **THEN** the panel closes on its own, the chip keeps showing the final status, and the feed is no
  longer mounted

#### Scenario: A ticket already finished stays open

- **WHEN** the human expands a chip whose ticket is already `done` or `cancelled`
- **THEN** the panel stays open until they close it

#### Scenario: Watching states do not collapse

- **WHEN** an expanded chip's ticket moves to in review, needs-you or blocked
- **THEN** the panel stays open

#### Scenario: Nothing is mounted while collapsed

- **WHEN** a message references six tickets and none of their chips is expanded
- **THEN** no feed is mounted and no extra subscription or connection is opened for any of them

#### Scenario: Live through the chat's own queries and stream

- **WHEN** an expanded chip's ticket moves on while the chat is open
- **THEN** its panel reflects the change from the queries and stream the chat already holds, with no
  new poll and no second connection
