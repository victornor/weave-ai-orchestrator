## MODIFIED Requirements

### Requirement: Every turn after the first is an ordinary worker turn

From the human's first message onward — delivered mid-turn or queued exactly as any message to a
worker is (VS-99) — an interactive session's agent SHALL be given its role's ordinary permission mode,
allowed and denied tools, with no restriction beyond the role's own.

Those tools SHALL NOT change the default posture. After the first turn the agent SHALL stay in
conversation — answering, investigating, reading, explaining — and SHALL NOT write code, transition
the ticket toward delivery, or create a plan or merge approval unless the human asked for changes in
the conversation. When the human does ask, the agent SHALL manage its ticket exactly as any worker
does: writing a plan, opening a pull request, transitioning the ticket, commenting, or recording a
document, and the ordinary approval gates SHALL apply unchanged.

#### Scenario: The second turn is unrestricted

- **WHEN** an interactive session's agent takes its second turn, following the human's first message
- **THEN** its tools are exactly its role's ordinary permission mode, allowed and denied tools — the
  first-turn restriction no longer applies

#### Scenario: The agent manages its own ticket afterward

- **WHEN** the human asks an interactive session's agent, after its first turn, to write a plan, open
  a pull request, move the ticket or record a document
- **THEN** it does so on its own ticket exactly as a worker would, including the same plan-approval
  and merge-approval gates
