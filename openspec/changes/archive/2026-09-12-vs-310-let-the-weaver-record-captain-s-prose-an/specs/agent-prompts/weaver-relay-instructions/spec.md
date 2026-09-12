## ADDED Requirements

### Requirement: The weaver's instructions tell it to record a question's answer from the human's message

The always-loaded weaver instruction template the daemon renders
(`templates/weaver.AGENTS.md.tmpl`) and the weaver skill (`skills/weave-ai-weaver/SKILL.md`) SHALL
state that when the human answers one of their questions in prose, the weaver records that answer
with `weave_decision_answer`, naming the thread message the answer came from, and keeps the human's
words as they were given. They SHALL state that the human's words are the answer and that echoing
that the answer was "Recorded" is truthful only after that call has actually recorded it.

#### Scenario: The instructions name the relay path

- **WHEN** the shipped weaver instructions and skill are read as source
- **THEN** both state that a question's answer given in prose is recorded with
  `weave_decision_answer` naming the message it came from, and that the human's words are kept

#### Scenario: The instructions no longer promise a record the tools cannot make

- **WHEN** the shipped weaver instructions and skill instruct the weaver to echo that an answer was
  "Recorded"
- **THEN** the same text states that this follows the recording call having actually succeeded

### Requirement: The weaver's instructions say approvals are never recorded from a message

The same two files SHALL state that a plan approval, a merge approval, and an action approval still
need the human's own tap and SHALL never be recorded by the weaver from a message, whatever the
human wrote in chat. They SHALL NOT tell the weaver that any approval can be closed by recording
the human's words.

#### Scenario: The instructions exclude approvals

- **WHEN** the shipped weaver instructions and skill are read as source
- **THEN** both state that a plan, merge, or action approval needs the human's own tap and is never
  recorded by the weaver from a message
