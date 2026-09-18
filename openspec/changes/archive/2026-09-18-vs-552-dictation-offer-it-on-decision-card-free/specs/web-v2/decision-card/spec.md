## ADDED Requirements

### Requirement: Free-text surfaces on a decision card offer dictation

Every free-text surface on the V2 decision card SHALL offer voice dictation: the free-text answer on
a card with options, a `text` input, a `multiline` input, and the written answer of a
`single_choice` input whose `allowOther` is set. Dictation SHALL be the same control and the same
behaviour as the V2 chat composer's — the same start and stop affordance, the same in-progress
state while listening and while transcribing, and the same insertion of the recognised speech into
whatever text the field already holds rather than replacing it. A card SHALL NOT carry a second,
divergent dictation implementation. A `secret` input SHALL NOT offer dictation, because its value
exists to stay out of the ordinary transcription path. A transcript discarded by the shared
minimum-word rule SHALL leave the field exactly as it was, and SHALL NOT submit anything.

#### Scenario: The free-text answer on a card with options offers dictation

- **WHEN** a card with options is open and the human opens its "write your own" answer
- **THEN** that answer offers a dictate control that starts and stops dictation and inserts the
  recognised speech into the answer text

#### Scenario: A multiline input offers dictation

- **WHEN** an open card carries a `multiline` input
- **THEN** that input offers the dictate control and inserts the recognised speech into its value

#### Scenario: A text input offers dictation

- **WHEN** an open card carries a `text` input
- **THEN** that input offers the dictate control and inserts the recognised speech into its value

#### Scenario: A single-choice input with allowOther offers dictation on the written answer

- **WHEN** an open card carries a `single_choice` input with `allowOther` and the human chooses to
  write their own answer
- **THEN** that written answer offers the dictate control and inserts the recognised speech into it

#### Scenario: A secret input does not offer dictation

- **WHEN** a card carries a `secret` input
- **THEN** that input offers no dictate control and remains keyboard-only

#### Scenario: Dictation inserts into existing text

- **WHEN** a card's free-text surface already holds typed text and the human dictates a phrase
- **THEN** the recognised phrase is inserted after the existing text, through the same control and
  behaviour the chat composer uses

#### Scenario: A too-short transcript leaves the card field unchanged

- **WHEN** a card field's dictation ends with a transcript below the shared minimum-word rule
- **THEN** the field is restored to exactly what it held before the mic opened and nothing is
  submitted
