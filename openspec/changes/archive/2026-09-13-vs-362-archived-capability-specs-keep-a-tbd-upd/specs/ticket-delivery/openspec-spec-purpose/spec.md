## Purpose

Keeps every capability spec's Purpose honest: a capability the daemon archives gets a real Purpose rather than the placeholder `openspec archive` writes, or the archive does not complete; a repository check rejects the placeholder if it ever returns; and the OpenSpec propose guidance tells a proposer to write the Purpose in the delta, where archive can carry it over.

## ADDED Requirements

### Requirement: An archived change leaves a new capability with a written Purpose

Whenever the daemon archives a change, it SHALL give every capability spec the archive created whose Purpose is still the placeholder sentence `openspec archive` writes a real Purpose, taken from the archived change's proposal "Why" section (its first non-empty paragraph, trimmed). For the archive-then-merge step this SHALL happen before the archive is committed, so the branch that merges carries a written Purpose. The same SHALL hold for the reconciliation backfill, on both the local-branch and pull-request paths, before the archive is committed or pushed.

When the change that created the capability has no usable "Why" text to draw from, the archive SHALL NOT complete with the placeholder in place. It SHALL fail on the same terms as any other archive failure, with a message that names the affected capability spec and states what to add — a `## Purpose` in the change's spec delta, or a "Why" in its proposal — so the worker that requested landing can fix it.

The placeholder SHALL be recognised by the same sentence `openspec archive` writes, not by a second, hand-copied spelling.

#### Scenario: A change whose proposal has a "Why"

- **WHEN** the daemon archives a change that created a capability whose spec still has the placeholder Purpose, and the change's proposal has a first "Why" paragraph
- **THEN** that capability's spec carries that paragraph as its Purpose
- **AND** no spec the archive created still contains the placeholder

#### Scenario: A change with no usable "Why" fails rather than landing a placeholder

- **WHEN** the daemon archives a change that created a capability whose spec still has the placeholder Purpose, and the change's proposal has no non-empty "Why" paragraph
- **THEN** the archive does not complete, the branch's spec keeps a written Purpose or the archive is not committed, and the failure names the capability spec and what to add
- **AND** for archive-then-merge this is treated as an archive failure: no merge happens and the ticket does not reach `done`

#### Scenario: The reconciliation backfill fills a capability it creates

- **WHEN** the reconciliation sweep archives a left-behind change that created a capability with the placeholder Purpose
- **THEN** the spec it commits or pushes has a Purpose drawn from that change's "Why", on both the local-branch and pull-request paths

### Requirement: A repository check rejects the archive placeholder

The project SHALL check, as part of its required checks, that no `openspec/specs/**/spec.md` contains the archive placeholder sentence. When one does, the check SHALL fail and name the offending spec files.

#### Scenario: A spec with the placeholder fails the check

- **WHEN** a main capability spec under `openspec/specs/` contains "TBD - created by archiving change … Update Purpose after archive."
- **THEN** the repository check fails and names that spec

#### Scenario: Authored Purposes pass the check

- **WHEN** every main capability spec has a Purpose that is not the archive placeholder
- **THEN** the check passes

### Requirement: The OpenSpec propose guidance tells a proposer to write a new capability's Purpose in its delta

The worker-facing OpenSpec guidance SHALL state that a change which creates a capability must give that capability its own `## Purpose` in the change's spec delta, and that `openspec archive` reads it when it builds the main spec, so the author's wording is carried over instead of the placeholder.

#### Scenario: The guidance names the delta Purpose

- **WHEN** the shipped OpenSpec skill that workers follow is read as source
- **THEN** it states that a new capability's `## Purpose` belongs in the change's delta and is carried over by archive
