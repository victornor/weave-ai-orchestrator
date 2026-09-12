# human-decisions/relayed-answers Specification

## Purpose
TBD - created by archiving change vs-310-let-the-weaver-record-captain-s-prose-an. Update Purpose after archive.

## Requirements

### Requirement: Only an askable, human-owned decision may be recorded from the human's message

`weave_decision_answer` SHALL answer a decision the weaver owns exactly as it does today. For a
decision owned by the human, it SHALL accept the answer only when the decision's kind is one an
agent may raise — the values of `ASKABLE_DECISION_KINDS`: `question`, `concern`, and
`gate_finding`. Every other human-owned kind — the generic `approval`, `plan_approval`,
`merge_approval`, `hire_approval`, `discard_approval`, `retry_approval`, and `action_approval` —
SHALL be refused with the same `forbidden` error the tool already returns for a human-owned
decision, and SHALL write nothing.

The set of acceptable kinds SHALL be read from the exported `ASKABLE_DECISION_KINDS` constant
rather than a second list typed into the handler, so a decision kind added later is refused by
default until it is deliberately made askable.

#### Scenario: A human-owned question is recorded from the human's message

- **WHEN** the weaver calls `weave_decision_answer` on a human-owned `question`, naming the inbound
  human message the answer came from
- **THEN** the answer is recorded against that decision

#### Scenario: A human-owned concern is recorded from the human's message

- **WHEN** the weaver calls `weave_decision_answer` on a human-owned `concern`, naming the inbound
  human message the answer came from
- **THEN** the answer is recorded against that decision

#### Scenario: A human-owned gate finding is recorded from the human's message

- **WHEN** the weaver calls `weave_decision_answer` on a human-owned `gate_finding`, naming the
  inbound human message the answer came from
- **THEN** the answer is recorded against that decision

#### Scenario: Every approval kind is refused

- **WHEN** the weaver calls `weave_decision_answer` on a human-owned decision of any approval kind —
  `approval`, `plan_approval`, `merge_approval`, `hire_approval`, `discard_approval`,
  `retry_approval`, or `action_approval` — however the human phrased the answer in chat
- **THEN** the call is refused as forbidden, the decision is unchanged, and nothing is written

#### Scenario: A decision the weaver owns is unaffected

- **WHEN** the weaver calls `weave_decision_answer` on a decision it owns
- **THEN** it is answered exactly as it was before this capability existed

### Requirement: A relayed answer names the human message it came from, and only a real one

For the human-owned path, `weave_decision_answer` SHALL require an argument naming the thread
message the answer came from. It SHALL refuse the call, writing nothing, when no message is named,
when the named message does not exist, when it belongs to another workspace's thread, when it was
not an inbound message, or when it was not authored by the human.

This validation is what makes the recorded answer trustworthy: without it the weaver could record
an answer the human never gave.

#### Scenario: No message is named

- **WHEN** the weaver calls `weave_decision_answer` on a human-owned question without naming a
  message
- **THEN** the call is refused and the decision remains `open` and unanswered

#### Scenario: The named message does not exist

- **WHEN** the weaver calls `weave_decision_answer` naming a message id that matches no message
- **THEN** the call is refused and the decision remains `open` and unanswered

#### Scenario: The named message belongs to another workspace

- **WHEN** the weaver calls `weave_decision_answer` naming a message whose thread belongs to a
  different workspace
- **THEN** the call is refused and the decision remains `open` and unanswered

#### Scenario: The named message is outbound

- **WHEN** the weaver calls `weave_decision_answer` naming a message the daemon or an agent sent to
  the human rather than one the human sent
- **THEN** the call is refused and the decision remains `open` and unanswered

#### Scenario: The named message was not authored by the human

- **WHEN** the weaver calls `weave_decision_answer` naming an inbound message that was not authored
  by the human
- **THEN** the call is refused and the decision remains `open` and unanswered

### Requirement: Only the workspace's weaver may record a relayed answer

Recording a relayed answer SHALL be refused unless the caller is the workspace's weaver agent. This
SHALL hold in the decision service itself, not only in the tool that exposes the path: a worker
relaying an answer the human never gave to it SHALL be structurally impossible rather than merely
unreachable through the tool's scope. A refused attempt SHALL write nothing and SHALL leave the
decision unchanged.

#### Scenario: A worker cannot relay

- **WHEN** an actor other than the workspace's weaver attempts to record a relayed answer, even
  naming a real inbound human message
- **THEN** the call is refused and the decision is unchanged

#### Scenario: The weaver can relay

- **WHEN** the workspace's weaver records an answer from a real inbound human message
- **THEN** the answer is recorded

### Requirement: A relayed answer records the human's words verbatim and marks the author apart from the writer

A relayed answer SHALL store the human's words in the decision's answer text exactly as they were
given — not summarised, normalised, or re-worded. If the weaver also maps the answer onto one of
the decision's options, that option's key SHALL be recorded as well, and it SHALL be one of the
decision's own option keys; an option the decision does not offer SHALL be refused.

The decision row SHALL record that the answer was written by the weaver agent and that its words
were authored by the human, together with a link to the message they came from. A relayed answer
SHALL be distinguishable from the human's own answer at the database level: a direct answer carries
no relay link and no author distinct from its writer, while a relayed answer always carries both,
and the presence of the link alone is definitive. The author's identity SHALL NOT be copied into a
second column when the linked message already carries it.

#### Scenario: The words are stored unaltered

- **WHEN** the human answers a question with prose and the weaver records it from their message
- **THEN** the decision's answer text is exactly the human's words

#### Scenario: A mapped option key is stored with the words

- **WHEN** the weaver records the human's answer and also maps it onto one of the decision's options
- **THEN** both that option's key and the human's verbatim words are stored

#### Scenario: An option the decision does not offer is refused

- **WHEN** the weaver records a relayed answer naming an option key the decision does not carry
- **THEN** the call is refused and the decision remains `open` and unanswered

#### Scenario: A relayed answer is not a tap

- **WHEN** a decision was answered by the weaver recording the human's message
- **THEN** its row records the weaver agent as the writer, the human as the author, and the message
  as a link, so it is distinguishable from a decision the human answered directly

#### Scenario: A direct answer is not a relay

- **WHEN** the human answers a decision directly, from a card or any other surface
- **THEN** its row carries no relay link and no author distinct from its writer

### Requirement: A relayed answer closes the card, wakes the asker, and is the record

Recording a relayed answer SHALL behave exactly as answering the decision any other way: the
decision SHALL leave `open` and become `answered`, a `decision.answered` event SHALL be emitted,
and the agent that asked SHALL be woken with the answer. The decision SHALL read as the record of
what was decided.

#### Scenario: The card closes

- **WHEN** the weaver records the human's answer from their message
- **THEN** the decision's status becomes `answered` and it no longer appears among the open cards

#### Scenario: The asker is woken

- **WHEN** the weaver records the human's answer from their message
- **THEN** the agent that asked the decision is woken with the recorded answer

#### Scenario: The answer is the record

- **WHEN** the decision is read back after a relayed answer
- **THEN** it shows the human's words as the answer, marked as relayed, exactly as a directly
  answered decision shows its answer

### Requirement: The durable decisions line records that the answer was relayed

When a relayed answer is remembered to the knowledge base, the durable `decisions.md` line SHALL
show that the answer was relayed from the human's message rather than given directly, alongside the
ticket identifier, the decision's title, and the answer it records.

#### Scenario: A remembered relayed answer

- **WHEN** a relayed answer is recorded with `remember` set
- **THEN** the line appended to `decisions.md` states that the answer was relayed from the human's
  message as well as what was answered

#### Scenario: A remembered direct answer is unchanged

- **WHEN** a directly answered decision is recorded with `remember` set
- **THEN** the line appended to `decisions.md` records it exactly as before this change
