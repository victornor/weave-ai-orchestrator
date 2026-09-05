## MODIFIED Requirements

### Requirement: Chat's reading position survives a workspace switch

The conductor chat SHALL keep, for the duration of the session and per workspace, the position the
human scrolled its message list to. Only a position the human chose SHALL be kept: the list's own
scrolling — opening at its newest message, and following content that arrives while the human is at
the bottom — SHALL NOT be recorded as a reading position, however far from the bottom the frames of
it pass.

Returning to a workspace's chat SHALL restore that workspace's position when the list had been
scrolled away from its newest message; when it was at the newest message, or was never scrolled away
from it, the chat SHALL simply open at the newest message. A position SHALL be restored only once
that chat's history has loaded, so that it is put back against the messages it was measured against
and never against the empty list shown before them. Each workspace's position SHALL be kept
separately from every other workspace's, and restoring one SHALL NOT consume another's.

Unsent composer text is outside this capability.

#### Scenario: Returning to a chat that was scrolled up

- **WHEN** the human scrolls workspace A's chat up into its history, jumps to workspace B's board,
  and returns to A's chat
- **THEN** A's chat is showing the part of the history it was left at

#### Scenario: Two workspaces read at different points

- **WHEN** the human has scrolled A's chat into its history while B's chat is at its newest message
- **THEN** returning to each shows that workspace's own position

#### Scenario: A chat left at the newest message

- **WHEN** the human leaves A's chat at its newest message and returns to it
- **THEN** A's chat opens at its newest message and keeps following new ones

#### Scenario: A chat that only ever scrolled itself

- **WHEN** the human opens a workspace's chat, lets it open at its newest message and follow a reply
  as it arrives, and leaves without scrolling the list themselves
- **THEN** returning shows the newest message, not a point the list's own scrolling passed through,
  and the chat keeps following

#### Scenario: The history has not loaded yet

- **WHEN** a chat with a kept position is opened and its history has not arrived
- **THEN** nothing is put back until the history is there, and the position is then restored against
  it
