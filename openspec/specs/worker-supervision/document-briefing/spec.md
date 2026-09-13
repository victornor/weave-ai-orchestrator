# worker-supervision/document-briefing Specification

## Purpose
Points a worker at the knowledge it needs before it starts: its brief names the linked document
relevant to the area it is about to touch, and its charter states which knowledge-write tool to use
for a new durable fact, so knowledge is read and written through the document layer, not only the hub.

## Requirements

### Requirement: A worker is instructed to read the document relevant to its area before starting

A worker's rendered brief and `AGENTS.md` SHALL instruct it to check the project hub's Documents
section, and any pointer left in the hub's Landmines or Conventions sections, for a linked document
relevant to the file or subsystem the ticket is about to touch, and to read that document
(`ac_knowledge_doc_get`) before starting work on it. This instruction SHALL appear both in the brief
(read once, at the start of a fresh ticket) and in the worker's `AGENTS.md` (read again on every
relaunch), so it reaches a worker whichever of the two it consults.

#### Scenario: A fresh ticket's brief names the instruction

- **WHEN** a worker's brief is rendered for a new ticket
- **THEN** it instructs the worker to check the hub's Documents section for one relevant to the area
  it is about to touch and to read it before starting

#### Scenario: A relaunched worker's `AGENTS.md` carries the same instruction

- **WHEN** a worker is relaunched and reads its `AGENTS.md`
- **THEN** the same instruction to check for and read a relevant document appears there

### Requirement: The charter states which knowledge-write tool to use for a new durable fact

The charter template's knowledge guidance SHALL state the choice between the three ways to record a
new durable fact: `ac_knowledge_note` targeting an existing linked document when one covers the
subject, `ac_knowledge_doc_put` to create a new document when the subject has none yet, and a plain
hub `ac_knowledge_note` when the fact fits no subject document.

#### Scenario: The charter names all three choices

- **WHEN** a worker reads its rendered charter's knowledge guidance
- **THEN** it states when to target an existing document, when to create a new one, and when to write
  to the hub directly
