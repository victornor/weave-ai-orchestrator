## MODIFIED Requirements

### Requirement: The explorer lists every artifact across the project's tickets

The document explorer SHALL offer an Artifacts entry listing every published artifact — a
`type = 'artifact'` work product backed by a stored `artifact:<key>` ticket document — belonging to
the tickets in the currently selected project scope (or every project when none is selected, matching
the explorer's existing project filter). Each listed artifact SHALL identify the ticket it belongs to
(at minimum its identifier), and SHALL carry its own title (or a fallback identifying label when none
was set), and its last-updated time. A `type = 'artifact'` work product with no stored artifact
document (a link-only record, whatever its URL) SHALL NOT appear in the Artifacts entry.

#### Scenario: An artifact published on one ticket is listed
- **WHEN** an agent has published an artifact to a ticket in the selected project scope
- **THEN** the explorer's Artifacts entry lists it, showing which ticket it came from

#### Scenario: Artifacts from multiple tickets all appear
- **WHEN** two different tickets in the same project each have a published artifact
- **THEN** the explorer's Artifacts entry lists both, each correctly attributed to its own ticket

#### Scenario: A link-only artifact work product is not listed
- **WHEN** a `type = 'artifact'` work product exists on a ticket in scope but no `artifact:<key>`
  document was ever stored for it
- **THEN** the explorer's Artifacts entry does not list it

### Requirement: A project with no artifacts shows no Artifacts entry

The explorer SHALL NOT show an Artifacts entry — empty or otherwise — for a project scope that has no
published artifacts on any of its tickets. A project whose only `type = 'artifact'` work products are
link-only records with no stored document SHALL be treated as having no artifacts for this purpose.

#### Scenario: A project that has never had an artifact published
- **WHEN** the explorer is opened for a project whose tickets have never published an artifact
- **THEN** no Artifacts entry appears anywhere in the tree

#### Scenario: A project whose only artifact rows are link-only
- **WHEN** every `type = 'artifact'` work product in the selected scope lacks a stored artifact
  document
- **THEN** no Artifacts entry appears anywhere in the tree
