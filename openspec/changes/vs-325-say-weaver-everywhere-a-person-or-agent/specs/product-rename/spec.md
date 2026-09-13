## ADDED Requirements

### Requirement: The human-readable agent name is `Weaver` wherever a person reads it

Every user-visible label, heading, title, status line, empty state, help text, error message and
notification in the web app and the TUI that names the workspace agent SHALL read `Weaver` (or
`weaver` where the sentence needs lowercase). A pointer to a settings section SHALL name a section
that exists. Internal code identifiers, wire values and legacy on-disk spellings are not display
text and SHALL NOT be renamed to satisfy this requirement.

#### Scenario: The chat header names the agent

- **WHEN** the chat route renders its header
- **THEN** the title reads `Weaver`, not `Conductor`

#### Scenario: A queued-message status names the agent

- **WHEN** the composer shows why a message is queued because the agent is mid-turn
- **THEN** the text reads `Weaver is replying — your message is queued`

#### Scenario: A settings model label names the agent

- **WHEN** the workspace or daemon Models settings render the agent's model control
- **THEN** the control's label reads `Weaver`, and a test that queries it by that label finds it

#### Scenario: A dictation pointer names a real settings section

- **WHEN** a dictation help or error message tells the reader where to configure a transcription
  provider
- **THEN** it names the Settings section that actually holds that setting (Dictation), not a section
  that does not exist

### Requirement: Server-written text names the agent `Weaver`

Every string the server writes for a human to read that names the workspace agent SHALL read
`Weaver`. This includes the decision-review follow-up line and route summaries.

#### Scenario: A review follow-up names the reviewer

- **WHEN** the channel manager writes the text follow-up for a decision the weaver has marked with
  concerns
- **THEN** the line begins `Weaver reviewed`, and the channels test asserts that prefix

### Requirement: Agent-facing display text names the role `Weaver`

Text shipped to agents that displays the role name — a turn header rendered from the stored agent
name, a shipped prompt template, and a shipped skill heading — SHALL read `Weaver`. Lowercase,
conceptual uses of the role noun are not display names and are out of scope.

#### Scenario: A turn header shows the stored name

- **WHEN** a stored weaver agent's turn prompt is built after the rename migration
- **THEN** its `# Turn N for …` header shows `Weaver (weaver)`

#### Scenario: A shipped skill heading names the role

- **WHEN** a shipped skill file displays which tools or knowledge the role owns
- **THEN** the heading reads `Weaver`, not `Conductor`

### Requirement: The stored default-named weaver is renamed; a custom name survives

On upgrade, a workspace whose weaver agent still carries the untouched default name `Conductor`
SHALL be renamed to `Weaver`. A weaver whose name was deliberately set to anything other than that
default SHALL keep its name. A newly created workspace SHALL name its weaver `Weaver`.

#### Scenario: The untouched default is renamed

- **WHEN** a workspace database with a `kind = 'weaver'` agent named `Conductor` is migrated
- **THEN** that agent's name is `Weaver`

#### Scenario: A deliberately customised name is left alone

- **WHEN** a workspace database with a `kind = 'weaver'` agent named something other than
  `Conductor` is migrated
- **THEN** its name is unchanged

#### Scenario: A new workspace names its weaver Weaver

- **WHEN** a workspace with no weaver agent is bootstrapped
- **THEN** the weaver it creates is named `Weaver`
