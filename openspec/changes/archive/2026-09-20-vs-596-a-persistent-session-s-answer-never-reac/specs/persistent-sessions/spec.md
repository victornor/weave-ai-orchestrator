## ADDED Requirements

### Requirement: A session's turn answer reaches its conversation thread

A persistent session that holds no ticket and whose turn was woken by a human message SHALL have that turn's final answer delivered to the session's own conversation thread as an outbound message attributed to the session, linked to the human message that woke it, without the session having to call any tool. The delivery SHALL be based on the turn's normalized result, so it behaves the same on every runtime a session can run on.

When the turn already produced an outbound message to that thread — a reply tool the session called — the daemon SHALL NOT add a second message for the same turn. A turn the human did not wake SHALL post nothing.

When the turn's final text is absent or whitespace-only, the daemon SHALL NOT write an answer message; the thread SHALL instead show, as a system notice, that the turn ended without an answer, so the conversation is never left silently blank.

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

#### Scenario: An empty answer is not a blank thread

- **WHEN** a session's turn ends with no final text or only whitespace
- **THEN** no answer message is written, and the thread states as a system notice that the turn ended without an answer

#### Scenario: Every runtime behaves the same

- **WHEN** a session runs a human-woken turn on any configured runtime and it succeeds with a final answer
- **THEN** the answer is delivered to the thread, because delivery reads the normalized turn result rather than a runtime-specific stream

### Requirement: A session's turn that ends without an answer states why

When a human-woken ticketless persistent session's turn ends without an answer — failed, timed out, cancelled or interrupted — the daemon SHALL post one system-authored notice to the session's thread naming the plain reason, without run ids or internals. A turn the daemon will retry or resume on its own SHALL NOT be announced until its final outcome is known; a turn that is retried or resumed and then succeeds SHALL post its answer exactly once.

#### Scenario: A failed turn says why

- **WHEN** a human-woken session turn ends failed
- **THEN** the thread shows one system notice naming the plain reason, with no run id

#### Scenario: A stopped turn says why

- **WHEN** a human-woken session turn times out, is cancelled, or is interrupted without being resumed
- **THEN** the thread shows a system notice that the turn was stopped before it could answer

#### Scenario: A retried or resumed turn is not announced early

- **WHEN** a session turn ends in a way the daemon retries or resumes on its own, such as a transient provider failure, a daemon shutdown, a live human message that interrupts it, or a runtime authentication outage
- **THEN** no notice is posted for that attempt

#### Scenario: A retried turn that then succeeds answers once

- **WHEN** a session turn is retried and a later attempt succeeds with a final answer
- **THEN** exactly one answer message is posted, and no earlier failure notice was posted
