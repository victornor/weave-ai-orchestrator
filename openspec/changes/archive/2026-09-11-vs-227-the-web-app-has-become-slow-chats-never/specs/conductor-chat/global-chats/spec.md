## ADDED Requirements

### Requirement: A pane’s history loads over REST without a live subscription

Each global-Chats pane SHALL populate its conductor thread from ordinary requests for that workspace’s threads and messages. Those requests SHALL NOT wait for a live workspace subscription to be open, connected, or caught up. An unfocused pane SHALL still make the thread and messages requests (or use already-fetched data) so it is not blank for lack of focus.

The messages request completing, or failing with an explicit error and retry, SHALL be what takes a pane off its loading state. Label data used to decorate the conversation (tickets, workers, traces) SHALL NOT gate that transition.

#### Scenario: History appears without a stream

- **WHEN** global Chats opens and the focused pane’s messages request completes while its live subscription is still connecting
- **THEN** that pane shows the thread history

#### Scenario: An unfocused pane still fetches history

- **WHEN** global Chats opens with more than one workspace and a pane is not focused
- **THEN** that pane still shows its workspace’s thread once its messages request completes, without opening a live subscription

#### Scenario: A messages failure is visible

- **WHEN** a pane’s messages request fails
- **THEN** that pane shows the failure and a way to retry, and is not left on the loading state indefinitely

### Requirement: Thread and messages requests are not queued behind chat decorations

On global Chats, each pane SHALL request that workspace’s thread list and messages without first waiting for the pane’s tickets, workers, retired-worker, or run-trace summary requests to finish. Those decoration requests MAY run afterwards or in parallel, but they SHALL NOT be what blocks the history from appearing.

A request whose only purpose is resolving identifier chips or dispatch labels SHALL NOT download each ticket’s full description.

#### Scenario: Messages are requested up front

- **WHEN** a global Chats pane mounts
- **THEN** it requests that workspace’s web threads and, once a thread id is known, that thread’s messages, without waiting for tickets, workers, or traces to return

#### Scenario: Ticket labels do not ship descriptions

- **WHEN** a pane fetches tickets in order to render dispatch labels or identifier chips in the chat
- **THEN** the payload does not include each ticket’s description body
