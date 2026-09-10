## MODIFIED Requirements

### Requirement: Sending in a pane talks to that workspace's conductor

A message posted in a pane SHALL land on that pane's workspace's primary web conductor thread and
SHALL get the conductor's reply in that same pane. The pane SHALL NOT request messages for a
thread id that belongs to a different workspace. Unsent composer drafts and the chat's reading
position SHALL remain per-workspace as they already are.

Only the focused pane (see "Exactly one pane is live at a time" below) SHALL stream a running
conductor turn's activity in real time. A turn running in an unfocused pane's
workspace SHALL still be reflected in that pane — the working indicator and the finished reply —
once the pane has the data to show it, but SHALL NOT stream token-by-token while unfocused.

#### Scenario: A message in Alpha's pane

- **WHEN** the human sends a message in the Alpha pane
- **THEN** the message is posted to Alpha's primary web conductor thread, and the reply appears in
  the Alpha pane

#### Scenario: Beta's pane is unaffected

- **WHEN** the human sends a message in the Alpha pane while the Beta pane is also showing
- **THEN** Beta's thread is not posted to and Beta's pane does not show Alpha's message

#### Scenario: A live turn stays in its pane

- **WHEN** Alpha's conductor is running a turn, Alpha is the focused pane, and global Chats is
  open
- **THEN** that turn's output streams in the Alpha pane and not in any other pane

## ADDED Requirements

### Requirement: Exactly one pane is live at a time

Global Chats SHALL hold at most one live workspace subscription at a time, regardless of how many
workspaces are listed, so the page's own connections do not scale with workspace count. The pane
whose workspace this subscription belongs to is the focused pane; it defaults to the first listed
workspace. The human SHALL be able to make any other pane the focused one by choosing it, at which
point the previously focused pane's live subscription closes and the newly focused pane's opens.

An unfocused pane SHALL still show that workspace's conductor chat — its loaded history, its open
decisions, its composer — from the data already fetched for it; it SHALL NOT be blank or
unusable for not being focused.

Becoming the focused pane SHALL refresh that workspace's messages and decisions so a pane that was
unfocused while its conductor did something is caught up rather than showing what it last held
while unfocused.

#### Scenario: The default focused pane

- **WHEN** global Chats opens with Alpha, Beta and Gamma listed
- **THEN** Alpha is the focused pane and Beta and Gamma are not

#### Scenario: Choosing a different pane

- **WHEN** the human chooses the Beta pane while Alpha is focused
- **THEN** Alpha's live subscription closes, Beta's opens, and Beta becomes the focused pane

#### Scenario: An unfocused pane still works

- **WHEN** Beta is not the focused pane
- **THEN** the Beta pane still shows Beta's loaded history and open decisions, and the human can
  still send a message in it

#### Scenario: Catching up on focus

- **WHEN** the human chooses the Beta pane and Beta's conductor replied while Beta was unfocused
- **THEN** the Beta pane shows that reply once it becomes focused

#### Scenario: Connections do not grow with workspace count

- **WHEN** ten workspaces are listed on global Chats
- **THEN** the page holds exactly one live workspace subscription open, the same as it would for
  two
