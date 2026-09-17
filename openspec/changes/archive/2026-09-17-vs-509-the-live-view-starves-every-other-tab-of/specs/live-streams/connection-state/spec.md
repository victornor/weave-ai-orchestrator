## MODIFIED Requirements

### Requirement: Persistent streams leave room for ordinary requests

The web app SHALL NOT hold so many persistent streams to the daemon, in one document or across
documents of the same origin, that ordinary HTTP requests to the same origin cannot complete.
Opening global Live, global Chats, or several workspace tabs at once SHALL still allow thread list,
thread messages, and message-send requests to start and finish.

Global surfaces that observe more than one workspace SHALL use one daemon-wide multiplexed live
connection per document, independent of the number of listed workspaces. A workspace-scoped surface
SHALL retain at most one live workspace subscription for that workspace, shared by its consumers.
The hidden-document pause/resume requirement still applies to both stream forms.

#### Scenario: Chats in a new tab while Live is open in another

- **WHEN** one document is showing global Live with live workers and another document of the same origin opens global Chats
- **THEN** Chats' thread-list and messages requests complete, rather than remaining in flight for as long as the Live document holds its one multiplexed stream

#### Scenario: One page with many workspaces

- **WHEN** the daemon reports ten workspaces and global Live is the only document open
- **THEN** global Live holds one daemon-wide live connection, not ten persistent workspace connections, and its ordinary requests complete

#### Scenario: A workspace page keeps its local stream bound

- **WHEN** a workspace-scoped Live page has several live workers and several components consume their events
- **THEN** those consumers share at most one persistent stream for that workspace
