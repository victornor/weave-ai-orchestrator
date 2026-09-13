## Purpose

The global V2 Incidents screen: the system incidents agents filed, as one flat, filterable list you
read rather than a console you operate.

## ADDED Requirements

### Requirement: One flat list with a real status filter

The V2 screen at `/v2/incidents` SHALL list incidents in one flat list, newest first, and SHALL offer
`All · Open · Resolved` chips. Choosing a chip SHALL show only incidents in that state, and any count
the screen shows SHALL derive from the same incidents data the list renders.

#### Scenario: Filter by state

- **WHEN** the human chooses `Open`
- **THEN** only unresolved incidents are listed

#### Scenario: The count agrees with the list

- **WHEN** a filter is active
- **THEN** any count shown equals the number of cards the same filtered list renders

### Requirement: The card carries status, title and meta

An incident card SHALL show a status dot that pulses while the incident is open, the incident's title,
and a meta line naming its state, its time and its scope. A resolved incident SHALL not pulse.

#### Scenario: An open incident pulses

- **WHEN** an unresolved incident is listed
- **THEN** its status dot pulses

#### Scenario: A resolved incident does not

- **WHEN** a resolved incident is listed
- **THEN** its status dot is static

### Requirement: Expanding shows the failure and the evidence

Expanding a card SHALL show what failed in a sentence, the incident's `evidence` as a log block, and a
note that the weaver is handling it and will ask in chat if it needs a decision. The screen SHALL show
no error-code field, and SHALL offer no Retry or Resolve controls.

#### Scenario: Expansion shows the record

- **WHEN** the human expands an incident
- **THEN** it shows what failed, its evidence block, and the note that the weaver handles it

#### Scenario: No action controls

- **WHEN** any incident is expanded
- **THEN** there is no Retry or Resolve control, and no error code is shown
