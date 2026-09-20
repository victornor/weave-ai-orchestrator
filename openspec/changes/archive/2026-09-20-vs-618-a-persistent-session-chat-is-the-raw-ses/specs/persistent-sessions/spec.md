## MODIFIED Requirements

### Requirement: Conversation is the default posture until asked to do work

Every turn of a persistent session that has no ticket SHALL be conversational: the agent answers, investigates and explains, and SHALL NOT be instructed to run any ticket delivery phase. It SHALL NOT be instructed to produce the worker's structured final report or any formatted reply for its own sake; the answer is its own words. The session's instructions SHALL tell it, when the human proposes work, to offer setting up a ticket and a worktree rather than proceeding informally, and SHALL make clear that both are opt-in: the human may decline either, in which case the session keeps working the conversation with no ticket and no worktree.

#### Scenario: A work-shaped request produces an offer, not a ticket

- **WHEN** a human describes work to a role's persistent session and has not asked it to file a ticket
- **THEN** the session offers to set up a ticket and a worktree, and does not create either on its own judgement

#### Scenario: Declining keeps the conversation ticketless

- **WHEN** the human declines the offer of a ticket and worktree
- **THEN** the session continues the conversation with no ticket and no worktree

#### Scenario: A ticketless session is not shaped to a report

- **WHEN** a ticketless persistent session's turn prompt is rendered
- **THEN** it instructs the session to answer the conversation directly and does not instruct it to run a ticket delivery phase or to finish with the worker's structured final report

### Requirement: A session's turn answer reaches its conversation thread

A persistent session that holds no ticket and whose turn was woken by a human message SHALL have that turn's final answer delivered to the session's own conversation thread as an outbound message attributed to the session, linked to the human message that woke it, without the session having to call any tool. The delivery SHALL be based on the turn's normalized result, so it behaves the same on every runtime a session can run on.

When the turn already produced an outbound message to that thread — a reply tool the session called — the daemon SHALL NOT add a second message for the same turn. A turn the human did not wake SHALL post nothing.

When a turn the daemon stopped on its own is resumed by a retry wake that carries no thread context, the daemon SHALL resolve the session's own thread for the delivery, and SHALL deliver only while that thread still holds a human message that no `agent`-authored outbound message follows — a system notice is not an answer — so an unrelated turn never answers a message that is no longer waiting, and the stopped attempt's own notice never stands in for the answer.

When the turn's final text is absent or whitespace-only, the daemon SHALL write no message for that turn. A turn that only ran tools, or ended after a tool result, is a normal, complete turn: the daemon SHALL NOT write a system notice for it. The turn's account of itself is its own transcript in the session's conversation surface.

#### Scenario: The answer lands in the thread

- **WHEN** a human messages a ticketless persistent session and its turn succeeds with a final answer
- **THEN** exactly one outbound message carrying that answer appears in the session's thread, attributed to the session

#### Scenario: The answer quotes the message that woke it

- **WHEN** that answer is delivered
- **THEN** it is linked to the human message that woke the turn, and when several human messages were batched into the one turn they are all linked

#### Scenario: A session that answers with a tool is not double-posted

- **WHEN** a session's turn has already written an outbound message to its thread
- **THEN** the daemon adds no second message for that same turn

#### Scenario: A turn the human did not wake is untouched

- **WHEN** a session's turn is woken by something other than a human message, such as a self-scheduled wake or a system repair
- **THEN** no answer is posted to the thread

#### Scenario: A resumed turn that lost its wake context still answers

- **WHEN** a session turn the daemon stopped on its own is resumed by a retry wake that carries no thread context, and the resumed turn succeeds
- **THEN** its answer is delivered to the session's own thread, linked to the human message still waiting there

#### Scenario: The stopped attempt's own notice does not stand in for the answer

- **WHEN** a stopped session turn posted its own system notice and its retry-woken resume then succeeds
- **THEN** the human's message is answered — the answer appears after that notice, linked to the message — so the notice is never the last word

#### Scenario: An unrelated turn does not answer a stale message

- **WHEN** a session's own thread ends in a human message the daemon stopped on its own, and an unrelated turn (a self-scheduled or system wake) runs without a retry
- **THEN** that turn posts nothing, because the fallback applies to a resume, not to any turn that finds an old message

#### Scenario: An empty answer is not a blank thread

- **WHEN** a human-woken session turn ends with no final text or only whitespace, having run tools
- **THEN** no message — neither an answer nor a system notice — is written to the thread for that turn, and the conversation is not left blank because the turn's own transcript is shown

#### Scenario: Every runtime behaves the same

- **WHEN** a session runs a human-woken turn on any configured runtime and it succeeds with a final answer
- **THEN** the answer is delivered to the thread, because delivery reads the normalized turn result rather than a runtime-specific stream

## ADDED Requirements

### Requirement: A session's conversation shows each turn's transcript

A persistent session's conversation surface SHALL render the conversation as the raw session, not as a list of delivered answers. For each turn it SHALL show, in order, the human message that woke it and then that turn's transcript: the assistant text as it was written, each tool call and its result, `edit`/`write` as diffs, file previews and command rows with their output, with the transcript renderer's syntax highlighting. The transcript SHALL render live while the turn runs and SHALL be unchanged after it ends. The surface SHALL scroll as one page and SHALL NOT nest a second scrolling region inside it.

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
- **THEN** its transcript streams while the turn runs and reads the same after it ends, with no second scrolling region inside the conversation

#### Scenario: The final text is shown once

- **WHEN** a turn's final text is delivered to the thread
- **THEN** the words appear once, in the turn's transcript, and not again as a separate message

#### Scenario: An answer not in the recorded events is still shown

- **WHEN** a finished turn's transcript carries no assistant text but the turn delivered a final answer to the thread
- **THEN** that answer is shown as part of the turn, once

#### Scenario: A failed turn still names its cause

- **WHEN** a session turn ends failed, timed out or cancelled
- **THEN** the conversation shows the turn's transcript and the system notice naming the plain reason
