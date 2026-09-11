## ADDED Requirements

### Requirement: A live stream pauses while its document is hidden

A live stream that is open in a document the browser reports as hidden SHALL close its persistent connection until that document becomes visible again. While hidden, the stream SHALL report a non-connected state that is distinct from a dropped connection the surface must manually recover. When the document becomes visible, the stream SHALL reconnect from the highest position it had already delivered, the same way it resumes after any other drop (`Reconnecting never loses or duplicates activity`).

This SHALL hold for the workspace event stream, the run event stream, and the job stream.

#### Scenario: Background tab releases its connections

- **WHEN** a live stream is connected and the document becomes hidden
- **THEN** that stream’s persistent connection is closed, and it is not held open in the background

#### Scenario: Returning to the tab resumes from the last position

- **WHEN** a live stream was paused because its document was hidden, and the document becomes visible
- **THEN** the stream reconnects and delivers activity that happened while it was paused, without repeating what the surface already has

#### Scenario: A hidden document does not look like a manual retry

- **WHEN** a live stream is paused because its document is hidden
- **THEN** the surface is not required to invoke manual retry to recover, and becoming visible is enough

### Requirement: Persistent streams leave room for ordinary requests

The web app SHALL NOT hold so many persistent streams to the daemon, in one document or across documents of the same origin, that ordinary HTTP requests to the same origin cannot complete. Opening global Live, global Chats, or several workspace tabs at once SHALL still allow thread list, thread messages, and message-send requests to start and finish.

A page that already limits itself to one live workspace subscription (`conductor-chat/global-chats`) SHALL keep that limit. Other surfaces that open per-workspace or per-run streams SHALL still honour this origin-wide room for REST.

#### Scenario: Chats in a new tab while Live is open in another

- **WHEN** one document is showing the global Live page with live workers, and another document of the same origin opens global Chats
- **THEN** Chats’ thread-list and messages requests complete, rather than remaining in flight for as long as the Live document holds its streams

#### Scenario: One page with many workspaces

- **WHEN** the daemon reports several workspaces and global Chats is the only document open
- **THEN** that page still holds at most one live workspace subscription, and its messages requests complete
