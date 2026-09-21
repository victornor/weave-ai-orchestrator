## MODIFIED Requirements

### Requirement: A session's conversation shows each turn's transcript

A persistent session's conversation surface SHALL render the conversation as the raw session, not as a list of delivered answers. For each turn it SHALL show, in order, the human message that woke it and then that turn's transcript: the assistant text as it was written, each tool call and its result, `edit`/`write` as diffs, file previews and command rows with their output, with the transcript renderer's syntax highlighting. The transcript SHALL render live while the turn runs and SHALL be unchanged after it ends.

The conversation SHALL be the whole history of the role's persistent session agent, across every session that agent has had, and NOT only the turns of its currently active session. The surface SHALL load the turns from the agent's own runs, selected for that agent rather than from a window shared with other agents' runs, so a turn belonging to a retired session is never omitted because other agents were active. Earlier turns SHALL be loaded as the reader scrolls back through the conversation, so the whole history remains reachable.

The conversation surface SHALL fill the frame between a pinned header and a pinned composer. Its transcript region SHALL be the only scrolling region: the document itself SHALL NOT scroll, the header and composer SHALL remain visible while the transcript scrolls, and no turn SHALL nest a second scrolling region inside the conversation.

A turn's final text SHALL be shown exactly once: the transcript is where it appears, and the delivered copy of that final text SHALL NOT be rendered a second time as its own message. A runtime whose final text is not among the turn's recorded events SHALL still have that text shown as part of the turn, so an answer is never lost.

A system notice SHALL still render as a notice, centred and attributed to the system, not as a message from either party.

#### Scenario: Several turns, each with its transcript

- **WHEN** a ticketless persistent session's conversation has had more than one human-woken turn
- **THEN** the surface shows each human message followed by that turn's transcript, in the order they happened

#### Scenario: A turn's tools, diff and file render between two messages

- **WHEN** a session turn between two human messages called a tool, edited a file and wrote another
- **THEN** the surface shows that turn's tool rows, the edit's diff, the written file's preview and any command output between the two human messages, syntax-highlighted

#### Scenario: Live, then unchanged

- **WHEN** a session's turn runs and then ends
- **THEN** its transcript streams while the turn runs and reads the same after it ends, the transcript region is the only scrolling region in the surface, and no turn nests a scrolling region of its own

#### Scenario: The header and composer stay while the transcript scrolls

- **WHEN** a session's conversation is longer than the viewport and the human scrolls its transcript
- **THEN** the transcript content moves under a header that stays at the top and a composer that stays at the bottom, and the document itself does not scroll

#### Scenario: The final text is shown once

- **WHEN** a turn's final text is delivered to the thread
- **THEN** the words appear once, in the turn's transcript, and not again as a separate message

#### Scenario: An answer not in the recorded events is still shown

- **WHEN** a finished turn's transcript carries no assistant text but the turn delivered a final answer to the thread
- **THEN** that answer is shown as part of the turn, once

#### Scenario: A failed turn still names its cause

- **WHEN** a session turn ends failed, timed out or cancelled
- **THEN** the conversation shows the turn's transcript and the system notice naming the plain reason

#### Scenario: Turns from a retired session are not hidden

- **WHEN** a role's persistent session agent had turns in an earlier session that was retired, and other agents in the workspace have been far more active since
- **THEN** the conversation still shows those earlier turns, each with its human message and its transcript, in order, not only the turns of the currently active session

#### Scenario: Earlier history is reachable by scrolling back

- **WHEN** the human scrolls a long session conversation back past its newest page
- **THEN** earlier turns and their human messages load and render, in order, until the whole history of the session agent has been shown

## ADDED Requirements

### Requirement: A retirement leaves a visible boundary naming its reason

When a role's persistent session is retired and a new session is started for the same agent, the conversation SHALL show a boundary at that point, between the last turn of the retired session and the first turn of the new one. The boundary SHALL name the reason the session was retired in plain words for the human, including at least: the agent's tools changed at an upgrade, the conversation had been idle for longer than the configured limit, the session's runtime changed, or the session was reset. The reason SHALL be recorded when the session is retired, so the boundary can be shown later from stored data rather than re-derived.

The boundary concerns the model's memory: it SHALL be shown where the new session began, so the human can see that the conversation continues but the model's context was reset there. An empty or unknown reason SHALL still render a boundary saying the conversation restarted, rather than omitting the boundary.

#### Scenario: A tool-contract retirement is marked

- **WHEN** a session was retired because the tool contract changed at an upgrade and a new session then ran a turn
- **THEN** the conversation shows, before that turn, a boundary saying the agent's tools changed at an upgrade

#### Scenario: An idle retirement is marked

- **WHEN** a session was retired because it had been idle longer than the configured limit
- **THEN** the conversation shows a boundary saying the conversation had been idle for a long time

#### Scenario: A runtime-change retirement is marked

- **WHEN** a session was retired because the session's runtime changed
- **THEN** the conversation shows a boundary saying the session's runtime changed

#### Scenario: The boundary is not shown without a retirement

- **WHEN** a session agent has only ever had one session
- **THEN** the conversation shows no retirement boundary

#### Scenario: The reason survives to be shown

- **WHEN** a session is retired and the surface is opened later
- **THEN** the boundary names the stored reason, not a value re-derived from the current tool contract or runtime

### Requirement: An involuntary retirement carries the conversation into the new session

When a persistent session is retired for a reason the human did not choose — a changed tool contract, or a conversation retired as idle — the first turn of the new session SHALL be given a compact account of the earlier conversation, so the new runtime begins with the conversation's substance rather than an empty context. The account SHALL be built from the conversation already stored for the agent — the human messages and the agent's delivered answers, in order, up to the retirement — and SHALL be bounded in size, so it cannot grow without limit and cannot be larger than the runtime's context can accept. The bound and what the account contains SHALL be stated in the design.

The carried account SHALL be context only: it SHALL NOT be presented as the human's new message, SHALL NOT be re-delivered to the conversation thread, and SHALL NOT replace the human's actual message for that turn.

When the retirement was chosen by the human — a session whose runtime was deliberately changed — the account SHALL NOT be carried forward; the surface's own statement that the conversation restarts on the new runtime SHALL continue to hold.

#### Scenario: A tool-contract retirement carries the conversation

- **WHEN** a session is retired because the tool contract changed and its next human-woken turn starts the new session
- **THEN** that turn's prompt contains a compact account of the earlier conversation, and the model is not started with an empty context

#### Scenario: The carried account is bounded

- **WHEN** the earlier conversation is very long
- **THEN** the carried account is trimmed to a stated bound, keeping the most recent part of the conversation, and the model still receives the human's current message in full

#### Scenario: The carried account is not a message

- **WHEN** the first turn of a new session after an involuntary retirement runs
- **THEN** no message is written to the conversation thread for the carried account, and the turn delivers only its own answer

#### Scenario: A chosen runtime change does not carry the conversation

- **WHEN** the human changes the session's option to one on a different runtime and the next turn starts a new session on it
- **THEN** the new session's first turn carries no account of the earlier conversation

#### Scenario: VS-542 still holds

- **WHEN** a session is retired because the tool contract changed
- **THEN** the new session still starts fresh rather than resuming, and its first turn is spawned under the current tool definitions
