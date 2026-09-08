## Purpose

Keeps every view that shows an open decision truthful about which decisions are still open, without
requiring the human to reload, even across a dropped and recovered connection.

## ADDED Requirements

### Requirement: A decision that leaves `open` status disappears from every view live

Wherever an open decision is listed — the conductor chat's pinned decision area, the Needs you view,
and any other surface that lists decisions by `open` status — a decision that becomes `superseded`,
`answered`, `expired` or `withdrawn` SHALL stop appearing there without the human reloading the page,
as soon as the client learns of the change.

#### Scenario: A plan approval is superseded while pinned in chat

- **WHEN** an open `plan_approval` decision pinned above the chat composer is superseded by a new
  decision
- **THEN** the superseded card is removed from the pinned area without a reload, and the pinned area
  shows the replacement instead if one is open

#### Scenario: A decision open in Needs you is answered from elsewhere

- **WHEN** a decision shown in the Needs you view is answered through another surface (chat, the CLI,
  or another device)
- **THEN** it is removed from the Needs you list without a reload

#### Scenario: A hidden decision's replacement is not itself hidden

- **WHEN** a decision hidden from the chat's pinned area (VS-72) is superseded
- **THEN** the replacement decision is a new, unhidden entry, and is shown in the pinned area if it is
  open

### Requirement: The decisions list reconciles to the server whenever the live connection recovers

Whatever caused a live-connection drop, or whether the client noticed the drop at all, the client
SHALL treat the decisions list it is displaying as unreliable at the moment the connection is
recognised as recovered, and SHALL refetch it from the server at that point rather than continuing to
show whatever was last known.

#### Scenario: A silent gap is closed on reconnect

- **WHEN** the workspace live connection reports moving into `connected` after not being `connected`
- **THEN** the client refetches the open decisions list, so a decision that changed status during the
  gap is corrected regardless of whether its change event was ever received

#### Scenario: A normal, uninterrupted connection is not refetched needlessly

- **WHEN** the workspace live connection has stayed `connected` throughout
- **THEN** the decisions list is not force-refetched outside of the normal event-driven updates
