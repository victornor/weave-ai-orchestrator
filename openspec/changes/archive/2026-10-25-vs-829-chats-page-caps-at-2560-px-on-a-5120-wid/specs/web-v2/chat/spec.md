## ADDED Requirements

### Requirement: The conversation column shares one widening measure

Chat's message column and its composer SHALL use one reading measure, resolved from the chat region's
own width, so the two never disagree and neither carries its own fixed pixel cap. While the region is
narrow the measure SHALL stay at the reading width, so text does not stretch into an unreadable line on a
usual desktop. Once the region is wide — which is what a pane of a side-by-side Chats row on a very wide
screen has — the measure SHALL widen with the region up to a bounded maximum, so the column uses the
pane instead of centring a narrow strip in it. The measure SHALL be a function of the region's width
only: the same region width SHALL always resolve to the same measure, regardless of viewport, device
pixel ratio or a sibling pane.

#### Scenario: A narrow region keeps the reading width

- **WHEN** the chat region is narrower than the widening threshold
- **THEN** the message column and composer are centred at the reading width and do not stretch

#### Scenario: A wide region widens the column

- **WHEN** the chat region is wider than the widening threshold
- **THEN** the message column and composer are wider than the reading width and centred in the region

#### Scenario: The measure is bounded

- **WHEN** the chat region grows past the point where the measure reaches its maximum
- **THEN** the column stops widening and stays centred

#### Scenario: The column uses the pane it is given

- **WHEN** a pane of the side-by-side Chats row is approximately half of a 5120 px-wide window
- **THEN** the message column and composer are substantially wider than the reading width, rather than a
  narrow strip centred in the pane

#### Scenario: A collapsed or hidden decisions pane does not change the measure

- **WHEN** the decisions pane opens, closes or is resized
- **THEN** the conversation column's measure is unchanged, because it follows the chat region's width
