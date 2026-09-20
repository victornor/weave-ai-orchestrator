## MODIFIED Requirements

### Requirement: A session's turn answer reaches its conversation thread

A persistent session that holds no ticket and whose turn was woken by a human message SHALL have that turn's final answer delivered to the session's own conversation thread as an outbound message attributed to the session, linked to the human message that woke it, without the session having to call any tool. The delivery SHALL be based on the turn's normalized result, so it behaves the same on every runtime a session can run on.

When the turn already produced an outbound message to that thread — a reply tool the session called — the daemon SHALL NOT add a second message for the same turn. A turn the human did not wake SHALL post nothing.

When a turn the daemon stopped on its own is resumed by a retry wake that carries no thread context, the daemon SHALL resolve the session's own thread for the delivery and SHALL deliver only the human messages the resumed run was woken by — the `human_message` wakes of the run the retry names — falling back to the thread's inbound messages that no `agent`-authored outbound message follows when the retry names no such run or it was not woken by a human. A system notice is not an answer. So a message that a completed tool-only turn already handled is never re-quoted by a later turn or resume, an unrelated turn never answers a message that is no longer waiting, and the stopped attempt's own notice never stands in for the answer.

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

#### Scenario: A completed tool-only turn's message is not re-quoted

- **WHEN** a session turn that posted no message (it only ran tools) has finished successfully, a second human message arrives, and that second turn is later resumed by a retry wake that carries no thread context
- **THEN** the resumed turn's answer is linked to the second human message only, never to the first message the completed tool-only turn already handled

#### Scenario: An empty answer is not a blank thread

- **WHEN** a human-woken session turn ends with no final text or only whitespace, having run tools
- **THEN** no message — neither an answer nor a system notice — is written to the thread for that turn, and the conversation is not left blank because the turn's own transcript is shown

#### Scenario: Every runtime behaves the same

- **WHEN** a session runs a human-woken turn on any configured runtime and it succeeds with a final answer
- **THEN** the answer is delivered to the thread, because delivery reads the normalized turn result rather than a runtime-specific stream

## ADDED Requirements

### Requirement: A ticketless persistent session installs no ticket-delivery skill

A ticketless persistent session's home SHALL install only the shipped skills whose `skills/manifest.json` audience applies to it — the `all`-audience skills — and SHALL NOT install `weave-ai-worker`, `weave-ai-openspec` or `weave-ai-scout`, whose rules are the worker's ticket protocol. When the session takes a ticket, the daemon SHALL re-render the session's home at that moment, so the worker-audience skills (`weave-ai-worker`, `weave-ai-openspec`, `weave-ai-scout`) are installed and a ticketed session is equipped exactly as a transient worker. When that ticket reaches a terminal status and the session returns to being ticketless, the daemon SHALL re-render the home again, so the ticket-delivery skills are removed. Re-rendering SHALL remove a skill the new posture no longer carries, not merely add the new ones.

#### Scenario: A ticketless session's home has no ticket-delivery skill

- **WHEN** a ticketless persistent session's home is rendered
- **THEN** the all-audience skills (`weave-ai-knowledge`, `weave-ai-artifacts`) are installed and none of `weave-ai-worker`, `weave-ai-openspec` or `weave-ai-scout` is

#### Scenario: Taking a ticket installs the worker skills at that moment

- **WHEN** a persistent session takes a ticket, whether existing or newly filed
- **THEN** its home is re-rendered as part of taking the ticket, and the worker-audience skills are installed under its runtime's skill path

#### Scenario: A finished ticket returns the session to the ticketless skill set

- **WHEN** a persistent session's ticket reaches a terminal status and the session returns to being ticketless
- **THEN** its home is rendered again, and the worker-audience skills are no longer present in it

#### Scenario: A transient worker is unaffected

- **WHEN** a transient worker's home is rendered
- **THEN** it installs exactly the worker- and all-audience skills it installs today
