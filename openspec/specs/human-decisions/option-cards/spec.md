# human-decisions/option-cards Specification

## Purpose
Defines how a decision that carries a defined set of options is put to the human and answered: how its card reads, where it sits in the conductor chat, how it is answered from the chat and from `Needs you`, and what it shows once it has been answered — so that a choice the conductor is waiting on is visible where it was asked, answerable in one gesture, and still readable in the history afterwards.

## Requirements

### Requirement: The conductor asks with options when the answer is a closed set

When the conductor needs an answer from the human that is one of a small, known set of alternatives, it SHALL raise a decision carrying those alternatives as options rather than putting the choice to the human as prose alone. The options SHALL be the answers the conductor is actually willing to act on, and the conductor SHALL say which one it recommends when it has a view.

Nothing about which questions the conductor asks, or how it words them, is changed by this requirement; it governs only the form a closed-set question takes.

#### Scenario: A choice between known alternatives

- **WHEN** the conductor needs the human to choose between a small, known set of answers
- **THEN** it raises a decision whose options are those answers

#### Scenario: An open-ended question

- **WHEN** the conductor needs something from the human that has no closed set of answers
- **THEN** it asks in prose, and no decision is raised

### Requirement: A decision with options is presented as a card

A decision awaiting the human SHALL be presented as a card showing the question, the context or recommendation behind it, and each of its options with its label and, when there is one, what that option means. An option the asker recommended SHALL be marked as such.

When the decision permits an answer in the human's own words, the card SHALL offer that as an alternative alongside the options. When it does not, the card SHALL offer only its options.

A card SHALL show what the decision is attached to — the ticket it concerns, when it concerns one — and SHALL say who is asking, distinguishing a question raised by the conductor from one raised by a worker.

#### Scenario: A question with options

- **WHEN** a decision carrying two or more options is shown to the human
- **THEN** the card shows the question and every option, each exactly once, with the recommended option marked

#### Scenario: An answer in the human's own words is allowed

- **WHEN** a decision allows an answer that is not one of its options
- **THEN** the card offers a way to write an answer as well as the options

#### Scenario: An answer in the human's own words is not allowed

- **WHEN** a decision requires one of its options
- **THEN** the card offers no way to write a different answer

#### Scenario: Who is asking

- **WHEN** the conductor raised the question
- **THEN** the card attributes it to the conductor rather than to a worker

### Requirement: Answering takes a choice and a send

Choosing an option on a card SHALL select it and SHALL NOT answer the decision. The card SHALL show which option is selected and SHALL offer a single action that sends the selected answer. Sending SHALL answer the decision with the selected option.

When the human writes an answer instead, sending that text SHALL answer the decision with those words.

Until an answer is sent, no answer SHALL be recorded, and the human SHALL be able to change the selection.

#### Scenario: Selecting does not answer

- **WHEN** the human picks one of a card's options
- **THEN** the option is shown as selected and the decision is not yet answered

#### Scenario: Changing the selection

- **WHEN** the human picks one option and then another before sending
- **THEN** the second option is the selected one, and the decision is still unanswered

#### Scenario: Sending the selected option

- **WHEN** the human sends after selecting an option
- **THEN** the decision is answered with that option

#### Scenario: Sending an answer in the human's own words

- **WHEN** the human writes an answer on the card and sends it
- **THEN** the decision is answered with those words

### Requirement: An answer from a card reaches the asker

An answer sent from a card SHALL be recorded against that decision exactly as an answer given any other way, and the agent that asked the question SHALL be woken with it, so that answering by card and answering in prose have the same consequences.

#### Scenario: The conductor is told

- **WHEN** the human answers a conductor question from a card
- **THEN** the answer is recorded against that decision and the conductor is woken with it

#### Scenario: An answer that is refused

- **WHEN** an answer cannot be recorded — the decision has already been answered, withdrawn or superseded
- **THEN** the human is told, and the card reflects the decision's real state rather than claiming the answer was taken

### Requirement: A conductor's question sits where it was asked

The conductor chat SHALL render the card for a decision the conductor raised during a turn as an item of the message list, directly after the conductor message that turn produced. The card SHALL keep that position as the conversation grows: messages that arrive afterwards SHALL be rendered after it, and the card SHALL NOT be moved to the end of the conversation.

A decision that cannot be attributed to a message in the open conversation SHALL still be visible while it is open, in a region below the conversation. Such a decision SHALL NOT be rendered as an anchored card.

Positions SHALL be derived from durable records, so that reloading the chat reproduces the same cards in the same positions.

#### Scenario: The question appears in the conversation

- **WHEN** the conductor replies to the human in a turn in which it raised a question for them
- **THEN** the card for that question appears directly after that reply

#### Scenario: The conversation continues

- **WHEN** further messages arrive after a card has appeared
- **THEN** they render after the card, and the card stays directly after the message it was anchored to

#### Scenario: A decision with no message to anchor to

- **WHEN** an open decision cannot be attributed to any message in the open conversation
- **THEN** it is shown in the region below the conversation rather than anchored to a message

#### Scenario: Reload

- **WHEN** the human reloads the chat
- **THEN** the same cards appear in the same positions, each in the state its decision is actually in

### Requirement: An answered card stays in place and becomes inert

Once a decision has been answered, its card SHALL remain where it is in the conversation rather than disappearing, and SHALL show what was answered: the label of the option that was chosen, or the words that were written, together with when it was answered.

An answered card SHALL offer no way to answer again: its options SHALL NOT be selectable and its send action SHALL NOT be offered.

#### Scenario: After answering

- **WHEN** the human answers a question from its card in the chat
- **THEN** the card stays in its position and shows the answer that was given

#### Scenario: The card cannot be answered twice

- **WHEN** a card shows an answered decision
- **THEN** it offers no way to select an option or send an answer

#### Scenario: The history survives a reload

- **WHEN** the human reloads the chat after answering
- **THEN** the answered card is still in its position, still showing the answer

### Requirement: The same question waits in Needs you

Every open decision awaiting the human SHALL appear in `Needs you` as a card with the same question and the same options as the card in the conversation, so that nothing the conductor is waiting on is reachable only by scrolling the chat.

Answering the decision in either place SHALL resolve it in both: the answer is recorded once, and both surfaces then show it as answered without the human having to answer again.

#### Scenario: A conductor question is waiting

- **WHEN** the conductor raises a question for the human
- **THEN** it appears in `Needs you` as a card with the same question and the same options

#### Scenario: Answered from Needs you

- **WHEN** the human answers the question in `Needs you`
- **THEN** the decision is answered, and the chat shows that card as answered rather than as waiting

#### Scenario: Answered from the chat

- **WHEN** the human answers the question in the chat
- **THEN** it is no longer waiting in `Needs you`

### Requirement: Prose questions are unaffected

A conductor message that is not backed by a decision SHALL be shown as it is today, with nothing added to it, and SHALL be answerable by replying in the conversation. The presence of the card mechanism SHALL NOT require a question to carry options in order to be asked or answered.

#### Scenario: A question asked in prose

- **WHEN** the conductor asks the human something in prose, with no decision behind it
- **THEN** the message renders as an ordinary message and no card appears for it

#### Scenario: Answering in prose

- **WHEN** the human replies to a prose question in the conversation
- **THEN** the reply reaches the conductor exactly as it does today
