## MODIFIED Requirements

### Requirement: The conductor asks with options when the answer is a closed set

When the conductor needs an answer from the human that is one of a small, known set of alternatives,
it SHALL raise a decision carrying those alternatives as options rather than putting the choice to
the human as prose alone. The options SHALL be the answers the conductor is actually willing to act
on, and the conductor SHALL say which one it recommends when it has a view.

When the conductor needs answers to several closed-set questions at once, it SHALL raise **one**
decision carrying them, one question per single-choice input, each with its own choices and its own
recommendation, rather than listing the questions in a chat message or raising one card per question.
Captain SHALL be able to answer them all in one send.

When what the conductor needs from the human is open-ended but is a value a card can collect — a
name, a URL, a note — it SHALL collect it with a text input on a decision rather than asking in
prose. A conversational statement or question with no decision behind it SHALL remain prose, and the
presence of the card mechanism SHALL NOT force one.

Nothing about which questions the conductor asks, or how it words them, is changed by this
requirement; it governs only the form a closed-set question and a collectable value take.

#### Scenario: A choice between known alternatives

- **WHEN** the conductor needs the human to choose between a small, known set of answers
- **THEN** it raises a decision whose options are those answers

#### Scenario: Several closed-set questions at once

- **WHEN** the conductor needs answers to several closed-set questions
- **THEN** it raises one decision carrying one single-choice question per input, each with its
  choices and its recommendation, instead of listing them in a chat message

#### Scenario: An open-ended question

- **WHEN** the conductor needs something from the human that has no closed set of answers but is a
  value it can collect on a card
- **THEN** it raises a decision with a text input for it rather than asking in prose

#### Scenario: A conversational question

- **WHEN** the conductor puts something to the human that is not a decision to be recorded — a
  statement, or a question answerable by replying in the conversation
- **THEN** it says it in prose, and no decision is raised
