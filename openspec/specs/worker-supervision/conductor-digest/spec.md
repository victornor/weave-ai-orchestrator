# worker-supervision/conductor-digest Specification

## Purpose
Defines what the conductor's periodic digest carries about a finished run: the summary the run
stored in its own report, attributed as the agent's own account rather than a verified outcome, the
explicit entry when no report was stored, and the size bounds that keep a burst of finished runs from
growing the digest without bound.

## Requirements

### Requirement: The digest carries a finished run's stored report summary

The periodic supervisor digest SHALL carry, for each finished run it reports, the summary text the
run stored in its own structured report, when the run stored one. The digest SHALL NOT report such a
run with only its identity and time when a stored summary exists.

#### Scenario: A finished run with a stored report

- **WHEN** a run finished with a stored structured report carrying a summary, and the run is one the
  digest includes
- **THEN** the run's digest entry carries that stored summary text

#### Scenario: A run whose report exists but the digest includes no other detail

- **WHEN** the digest is built after such a run finished
- **THEN** the run's entry carries the summary without the conductor having to call the run
  inspection tool

### Requirement: The summary is presented as the agent's own account

The summary the digest carries SHALL be identified as the reporting agent's own account, and SHALL
NOT be presented as a verified outcome. An entry's summary SHALL be distinguishable from any value
the daemon itself computed or confirmed.

#### Scenario: The entry attributes the summary to the agent

- **WHEN** the digest entry for a run that stored a report carries its summary
- **THEN** the entry marks that summary as the reporting agent's own words, not as a verified result

#### Scenario: A summary is never presented as evidence

- **WHEN** the conductor reads a digest entry carrying a stored summary
- **THEN** nothing in the entry presents that summary as a daemon-verified fact

### Requirement: A run with no stored report still produces a sensible entry

A finished run that stored no structured report, including one that failed before recording a report,
SHALL produce a digest entry that states plainly that no report was recorded. The entry SHALL NOT
carry an empty or blank summary.

#### Scenario: A run that finished without a report

- **WHEN** a finished run that the digest includes stored no structured report
- **THEN** its digest entry states that no report was recorded, rather than carrying a blank summary

#### Scenario: A run that failed before producing a report

- **WHEN** a run failed before it could record a report, and the digest includes it
- **THEN** its digest entry states that no report was recorded

### Requirement: The carried summary text is bounded

The digest SHALL cap the summary it carries for a single run to a fixed per-entry limit, and SHALL
cap the total summary text it carries across all entries of one digest to a fixed ceiling. When the
ceiling is reached, the remaining entries SHALL indicate that their summary was omitted rather than
the digest continuing to grow. The number of finished runs occurring between two digests SHALL NOT
make the digest unbounded.

#### Scenario: A single very long summary

- **WHEN** a run stored a summary longer than the per-entry limit
- **THEN** the digest entry carries a capped summary with a visible marker that it was truncated

#### Scenario: Many finished runs between two digests

- **WHEN** many digest-worthy runs finish between two digests
- **THEN** the total summary text the digest carries stays within the ceiling, and entries whose
  summary was left out say so

#### Scenario: The digest's existing event bound is preserved

- **WHEN** more digest-worthy events occur between two digests than the digest includes
- **THEN** the digest still bounds the number of events it lists, exactly as before this change

### Requirement: The digest drops only decisions the weaver itself asked

The digest SHALL include a `decision.created` event when the decision was raised by an agent other than the weaver — a worker, or the system with no asking agent — regardless of which side owns the approving answer. It SHALL drop a `decision.created` event only when the decision's asking agent is the weaver itself, because a card the weaver raised is not news to it.

This restores a worker-raised human-owned approval — every `plan_approval`, `merge_approval` and `action_approval` a worker raises — as a digest event, while a decision the weaver asked the human stays out.

#### Scenario: A worker-raised human-owned approval is digest news

- **WHEN** a worker raises a human-owned `merge_approval` and a digest is built that covers its creation
- **THEN** the digest includes the `decision.created` event for it

#### Scenario: A system-raised human-owned approval is digest news

- **WHEN** the system raises a human-owned `plan_approval` (with no asking agent) and a digest is built that covers its creation
- **THEN** the digest includes the `decision.created` event for it

#### Scenario: A weaver-raised decision is dropped

- **WHEN** the weaver itself asks the human a `question`, and a digest is built that covers its creation
- **THEN** the digest drops that `decision.created` event
