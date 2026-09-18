## ADDED Requirements

### Requirement: A sent message shows the roadmap block it carried

A human message shown in the conductor chat that was sent with a roadmap block SHALL display that
block on the message, beside the project marker it already shows, in the same tag idiom rather than a
second style of chip, and SHALL name the block by its human-readable title rather than by its
identifier. The marker SHALL be shown only when the message's block can be named; an identifier SHALL
never be shown in its place. A message sent with a project and no block SHALL render exactly as it did
before this capability existed, showing only the project marker.

The block marker SHALL NOT displace or narrow the message body, and SHALL read correctly at phone
width as well as on desktop.

#### Scenario: A message sent with a project and a block shows both

- **WHEN** a human message that carried a project and one of that project's blocks is rendered in the
  chat
- **THEN** the message is shown with both the project marker and a marker naming that block

#### Scenario: A message sent with a project and no block is unchanged

- **WHEN** a human message that carried a project and no block is rendered in the chat
- **THEN** it is shown with the project marker only, exactly as a message sent before this capability
  existed

#### Scenario: The marker names the block, not its id

- **WHEN** a message that carried a roadmap block is rendered
- **THEN** the marker shows that block's current title, and never its identifier

#### Scenario: A block that can no longer be named shows no marker

- **WHEN** a message carried a block that can no longer be resolved to a title
- **THEN** the message renders without a block marker and still renders its body, project marker and
  metadata

#### Scenario: The marker reads at phone width

- **WHEN** a message carrying a project and a block is rendered at a phone-sized viewport
- **THEN** the marker and the project marker stay within the message's own column, the message body is
  unchanged, and nothing is pushed outside the viewport
