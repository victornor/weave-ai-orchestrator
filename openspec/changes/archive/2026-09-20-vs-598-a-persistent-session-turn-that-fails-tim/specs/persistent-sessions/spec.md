## MODIFIED Requirements

### Requirement: A session's turn answer reaches its conversation thread

A persistent session that holds no ticket and whose turn was woken by a human message SHALL have that turn's final answer delivered to the session's own conversation thread as an outbound message attributed to the session, linked to the human message that woke it, without the session having to call any tool. The delivery SHALL be based on the turn's normalized result, so it behaves the same on every runtime a session can run on.

When the turn already produced an outbound message to that thread — a reply tool the session called — the daemon SHALL NOT add a second message for the same turn. A turn the human did not wake SHALL post nothing.

When a turn the daemon stopped on its own is resumed by a retry wake that carries no thread context, the daemon SHALL resolve the session's own thread for the delivery, and SHALL deliver only while that thread still holds a human message that no `agent`-authored outbound message follows — a system notice is not an answer — so an unrelated turn never answers a message that is no longer waiting, and the stopped attempt's own notice never stands in for the answer.

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

- **WHEN** a session's turn ends with no final text or only whitespace
- **THEN** no answer message is written, and the thread states as a system notice that the turn ended without an answer

#### Scenario: Every runtime behaves the same

- **WHEN** a session runs a human-woken turn on any configured runtime and it succeeds with a final answer
- **THEN** the answer is delivered to the thread, because delivery reads the normalized turn result rather than a runtime-specific stream

### Requirement: A session's turn that ends without an answer states why

When a human-woken ticketless persistent session's turn ends without an answer — failed, timed out, cancelled or interrupted — the daemon SHALL post one system-authored notice to the session's thread naming the plain reason, without run ids or internals. A turn that will be retried by the retry ladder, or resumed from the same wake after a daemon shutdown or a live human message, SHALL NOT be announced until its final outcome is known; a turn that is retried or resumed and then succeeds SHALL post its answer exactly once. A watchdog cut SHALL announce itself — there is no reliable signal at that moment that a resume is coming — and its later resume SHALL answer past that notice (the requirement above), so the notice is never the last word.

A notice for a usage limit SHALL name the limit, SHALL give the reset instant when the runtime reported one, and SHALL state that nothing retries a usage limit automatically, so another message is needed. A notice for an expired runtime login SHALL say that a new login is needed and what happens next — that the conversation resumes once the login is renewed, or, when the outage has exhausted the automatic recovery and parked the work, that the human must log in and retry.

#### Scenario: A failed turn says why

- **WHEN** a human-woken session turn ends failed
- **THEN** the thread shows one system notice naming the plain reason, with no run id

#### Scenario: A stopped turn says why

- **WHEN** a human-woken session turn times out, is cancelled, or is interrupted by the watchdog
- **THEN** the thread shows a system notice that the turn was stopped before it could answer

#### Scenario: A retried or resumed turn is not announced early

- **WHEN** a session turn ends in a way the daemon retries or resumes from the same wake, such as a transient provider failure with retries remaining, a daemon shutdown, or a live human message that interrupts it
- **THEN** no notice is posted for that attempt

#### Scenario: A retried turn that then succeeds answers once

- **WHEN** a session turn is retried and a later attempt succeeds with a final answer
- **THEN** the retry's answer is posted, and no notice was posted for the retryable attempt itself

#### Scenario: A usage-limit notice gives the reset and the next step

- **WHEN** a session turn is stopped by a runtime usage limit, with or without a reset the runtime reported
- **THEN** the notice names the usage limit, gives the reset when there is one, and says that nothing retries automatically so another message is needed

#### Scenario: An expired login says what happens next

- **WHEN** a session turn ends because the runtime's login expired
- **THEN** the notice says a new login is needed and whether the conversation resumes once it is renewed or the human must log in and retry

#### Scenario: A resumed turn's failure is stated once

- **WHEN** a session turn the daemon stopped on its own is resumed by a retry wake and that resumed turn finally fails
- **THEN** exactly one notice is posted for the resumed turn, after whatever the stopped attempt itself posted