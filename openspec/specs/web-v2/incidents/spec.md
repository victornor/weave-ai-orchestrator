# web-v2/incidents Specification

## Purpose
The global V2 Incidents screen: the system incidents agents filed, as one flat, filterable list you
read rather than a console you operate.

## Requirements

### Requirement: One flat list with a real status filter

The V2 screen at `/v2/incidents` SHALL list incidents in one flat list, newest first, and SHALL offer
`All · Open · Resolved` chips. Choosing a chip SHALL show only incidents in that state, and any count
the screen shows SHALL derive from the same incidents data the list renders. The screen SHALL open
with `Open` active, so its first view lists only incidents whose `resolvedAt` is null and agrees with
any badge that counts open incidents.

#### Scenario: Filter by state

- **WHEN** the human chooses `Open`
- **THEN** only unresolved incidents are listed

#### Scenario: The count agrees with the list

- **WHEN** a filter is active
- **THEN** any count shown equals the number of cards the same filtered list renders

#### Scenario: The page opens on open incidents

- **WHEN** the human opens the Incidents page with resolved and unresolved incidents present
- **THEN** only unresolved incidents are listed and the `Open` chip is the active one

#### Scenario: The default view agrees with the nav badge

- **WHEN** every incident is resolved and the nav badge counts zero open incidents
- **THEN** the page opens on an empty list, not a list of resolved incidents

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

### Requirement: The empty state says what is actually true of the active filter

When the loaded incident list matches no incident under the active filter, the screen SHALL show a
worded empty state whose title and detail describe the active filter's state rather than a generic
"nothing here". Under `Open` — the state that will be true most of the time — the empty state SHALL
read as there being nothing wrong, not as a list that failed to find anything. Under `Resolved` it
SHALL read as nothing having been resolved yet. When no incident has ever been filed, the empty state
SHALL say that instead.

#### Scenario: No open incidents reads as all clear

- **WHEN** the page opens on `Open` and every incident is resolved
- **THEN** the empty state says there is nothing open, in words that read as nothing being wrong, and not the generic "nothing in this filter" wording

#### Scenario: Nothing resolved yet

- **WHEN** the human chooses `Resolved` and no incident has been resolved
- **THEN** the empty state says nothing has been resolved yet

#### Scenario: Nothing has ever been filed

- **WHEN** the loaded list is empty
- **THEN** the empty state says no incident has been filed and does not offer another filter
