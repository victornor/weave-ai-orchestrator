## Purpose
Describes how the system measures the knowledge context a run consumed — the hub files it was
bootstrapped with and the documents it read — separately from a run's total context, so the
index-and-documents split can be judged on evidence rather than assumption.

## ADDED Requirements

### Requirement: A run records the knowledge context it consumed

Every run SHALL record, as it happens, the tokens of every knowledge hub file rendered into its
bootstrap digest — as actually rendered into the prompt, never the file's stored estimate when the
two differ — attributed to the scope it came from, and to the project it came from when the scope is
`project`.

Every run SHALL also record the tokens of every document a knowledge read returned during the run,
whether returned by an explicit hub read or by a document read by slug, attributed to the scope
(and project, and slug when there is one) it was read from. A document read more than once in the
same run SHALL be recorded once, at its size the first time it was read, not once per read.

A run that never read any knowledge and had none rendered into its bootstrap digest SHALL record a
knowledge context of zero, never a missing or null record.

#### Scenario: A worker's bootstrap digest is recorded

- **WHEN** a worker's turn begins with a bootstrap digest built from the shared hub and its
  project's hub
- **THEN** the run's recorded knowledge context includes the shared hub's tokens and the project
  hub's tokens as they were actually rendered into that digest

#### Scenario: A conductor's per-project bootstrap chunks are recorded separately

- **WHEN** the conductor's bootstrap digest includes a chunk for each project's overview and
  current-focus sections
- **THEN** the run's recorded knowledge context includes one entry per project, each with that
  chunk's own token count, not the project hub file's full token count

#### Scenario: A document read twice in one run costs its size once

- **WHEN** a run reads the same document by slug twice in the same turn
- **THEN** the run's recorded knowledge context counts that document's tokens once

#### Scenario: An explicit hub read is recorded as a read, not folded into bootstrap

- **WHEN** a run explicitly reads a hub scope that was already rendered into its bootstrap digest
- **THEN** the run's recorded knowledge context records that read separately from the bootstrap
  entry for the same scope, because the tool result is content returned to the model a second time

#### Scenario: A run that touches no knowledge

- **WHEN** a run's bootstrap digest was empty and it made no knowledge reads
- **THEN** the run's recorded knowledge context is zero across the board, not absent

### Requirement: A ticket reports the knowledge context of its work

A ticket SHALL report the sum of the knowledge context recorded by its own runs, split into hub
tokens and document tokens, and the distinct documents (by scope and slug) that any of its runs
read.

#### Scenario: A ticket with several runs

- **WHEN** a ticket's work spans more than one run, some of which read different documents
- **THEN** the ticket's reported knowledge context is the sum of every run's tokens, and the
  document list is the union of every run's distinct documents, not just the latest run's

#### Scenario: A ticket with no knowledge reads

- **WHEN** none of a ticket's runs recorded any knowledge context
- **THEN** the ticket reports zero knowledge tokens and an empty document list

### Requirement: The usage view answers whether the knowledge split is paying off

For a project and a time window, the system SHALL be able to report: the average knowledge tokens
recorded per run, the documents read most often ranked by how many runs read them, and the
documents that exist in that project's knowledge base but were read by no run in the window.

#### Scenario: Average knowledge tokens per run

- **WHEN** a project's runs in a window recorded varying knowledge context
- **THEN** the usage view reports the average total knowledge tokens per run across that window

#### Scenario: Documents read most often

- **WHEN** several documents were read across a project's runs in a window
- **THEN** the usage view ranks them by how many distinct runs read each one, most-read first

#### Scenario: Documents never read

- **WHEN** a project's knowledge base has a document that no run read within the window
- **THEN** the usage view lists that document among the documents never read, distinctly from
  documents that were read at least once

### Requirement: A knowledge-context figure states its own method

Wherever a knowledge-context figure is shown — on a run, a ticket, or the usage view — it SHALL be
labelled as knowledge context and SHALL state in one line that it is measured from what was actually
sent or returned, not estimated from a file on disk after the fact, so it is never mistaken for a
run's total context.

#### Scenario: A ticket's knowledge tab

- **WHEN** a human opens the knowledge-context figures for a ticket
- **THEN** the view states in one line that these are knowledge-context tokens measured from what
  was actually sent or returned, distinct from the ticket's total-context usage figures

### Requirement: Measuring knowledge context never changes agent behaviour

Recording and reporting knowledge context SHALL NOT throttle, cap, refuse, or otherwise alter any
run, tool call, or knowledge read. A failure to record a knowledge-context event SHALL NOT fail or
degrade the run it happened in.

#### Scenario: Recording fails silently

- **WHEN** recording a run's bootstrap or read tokens fails for any reason
- **THEN** the run proceeds exactly as it would have otherwise, with no error surfaced to the agent

### Requirement: Knowledge-context accounting does not depend on the index-and-documents split

Knowledge-context accounting SHALL record and report correctly whether or not a project's knowledge
has been split into hub-plus-linked-documents, so the same measurement is the before-and-after
evidence for that split.

#### Scenario: Before the split

- **WHEN** a project's knowledge is still a single hub file with no linked documents
- **THEN** its runs' recorded knowledge context still reports hub tokens correctly, with a document
  count of zero

#### Scenario: After the split

- **WHEN** a project's knowledge has been split into a hub plus linked documents
- **THEN** its runs' recorded knowledge context reports both the smaller hub tokens and the tokens
  of whichever documents were read, on the same measurement used before the split
