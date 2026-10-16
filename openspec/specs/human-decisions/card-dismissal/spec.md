# human-decisions/card-dismissal Specification

## Purpose
Lets a human dismiss a decision card an agent raised, with an optional reason, and tells the agent
that asked it was dismissed rather than answered, so the agent can re-raise a corrected card or drop it.

## Requirements

### Requirement: A human can dismiss an agent-raised card with an optional reason

The daemon SHALL let a human dismiss an open decision whose kind is one an agent may raise — the
values of `ASKABLE_DECISION_KINDS` (`question`, `concern`, `gate_finding`) — supplying an optional
free-text reason. A dismissed decision SHALL leave `open`, be recorded as `withdrawn` with the
dismissing human and time recorded, carry the trimmed reason as its answer text (empty when none was
given), and be logged as a `decision.dismiss` activity. Dismissal SHALL be refused, writing nothing,
for any other kind, for a decision that is not open, and for any actor that is not a human. The
acceptable kinds SHALL be read from `ASKABLE_DECISION_KINDS`, not a second list.

#### Scenario: Dismissing with a reason

- **WHEN** a human dismisses an open `question` with the reason "wrong project"
- **THEN** the decision is `withdrawn`, its answer text is "wrong project", and it records the human who dismissed it

#### Scenario: Dismissing with no reason

- **WHEN** a human dismisses an open `concern` and gives no reason
- **THEN** the decision is `withdrawn` with no reason recorded

#### Scenario: A system approval cannot be dismissed

- **WHEN** a dismissal is requested for an open `merge_approval`
- **THEN** it is refused with a `forbidden` error and the decision stays open

#### Scenario: A closed decision cannot be dismissed

- **WHEN** a dismissal is requested for a decision that is already answered, withdrawn or superseded
- **THEN** it is refused with a `wrong_status` error

#### Scenario: An agent cannot dismiss

- **WHEN** an agent actor requests a dismissal
- **THEN** it is refused with a `forbidden` error

### Requirement: The asker is told the card was dismissed, with the reason

When a dismissed decision has an asking agent, the daemon SHALL wake that agent with a
`decision_answered` wake whose payload names the decision, is marked `dismissed: true`, and carries
the reason when one was given and no `answer`. The asker's next turn SHALL list the decision under its
decisions section as dismissed — not answered — quote the reason, and say the card was not answered,
so the agent re-raises a corrected card or drops the matter. `weave_inbox` SHALL surface the same wake
under its decisions with the dismissed decision. A dismissal SHALL NOT be reported to the agent as an
answer, and the dismissed decision SHALL NOT appear under "Answered decisions".

#### Scenario: The weaver learns why

- **WHEN** a human dismisses a weaver-raised question with the reason "this belongs on VS-12"
- **THEN** the weaver is woken, and its next turn names the decision as dismissed with "this belongs on VS-12"

#### Scenario: No reason given

- **WHEN** a human dismisses a card with no reason
- **THEN** the weaver's turn says the card was dismissed with no reason given

#### Scenario: Not an answer

- **WHEN** the weaver reads its decisions after a dismissal
- **THEN** the dismissed decision is not listed as answered and carries no answer key

### Requirement: Dismissal is available over the HTTP API and the CLI

The daemon SHALL expose `POST /decisions/{id}/dismiss` taking an optional `reason`, and the CLI SHALL
expose `weave decision dismiss <id> [--reason <text>]`, both calling the same service operation.

#### Scenario: Dismiss from the CLI

- **WHEN** a human runs `weave decision dismiss <id> --reason "wrong project"` on an open question
- **THEN** the decision is dismissed with that reason
