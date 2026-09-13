# ticket-artifacts/explorer Specification

## Purpose
Makes every published artifact findable from the knowledge base's document explorer instead of only
from the ticket that produced it, without giving artifacts any knowledge-document identity.

## Requirements

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

### Requirement: The Artifacts entry is a flat, recency-ordered list

The Artifacts entry SHALL present its artifacts as a flat list ordered by most-recently-updated first,
not grouped into per-ticket or per-kind folders. A ticket's identity remains visible on each row
regardless of ordering.

#### Scenario: A recently republished artifact sorts to the top
- **WHEN** an artifact that was published earlier than others is republished (a new revision)
- **THEN** it appears ahead of artifacts whose most recent revision is older, without needing to open
  a per-ticket or per-kind grouping to find it

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

### Requirement: Opening a listed artifact reuses the ticket's own sandboxed viewing path

Selecting an artifact from the explorer's Artifacts entry SHALL render it through the same
session-authenticated, sandboxed serving route and Content-Security-Policy already enforced on the
ticket page's own artifact viewer — never a second rendering path, and never with a relaxed policy
because the request originated from the explorer.

#### Scenario: The explorer's rendered artifact carries the same sandbox CSP
- **WHEN** a human opens an artifact from the explorer's Artifacts entry
- **THEN** the response actually loaded to render it carries the same sandboxing
  `Content-Security-Policy` (`sandbox` directive, `default-src 'none'`, `connect-src 'none'`) as
  opening that artifact from its ticket's own Artifact tab

### Requirement: A newly published artifact appears without a manual reload

Publishing a new artifact, or a new revision of an existing one, to a ticket in the current project
scope SHALL make it appear (or move to the top of) the explorer's Artifacts entry without the human
needing to reload the page.

#### Scenario: A human is already browsing the explorer when an artifact is published
- **WHEN** an agent publishes an artifact to a ticket while a human already has the explorer open on
  that ticket's project
- **THEN** the new artifact appears in the Artifacts entry without a page reload

### Requirement: Listed artifacts are not knowledge documents

The Artifacts entry and its listing SHALL NOT grant artifacts a document slug, SHALL NOT make them
targets of `[[slug]]` links, and SHALL NOT include them as nodes in the knowledge graph.

#### Scenario: An artifact cannot be linked by slug
- **WHEN** an artifact appears in the explorer's Artifacts entry
- **THEN** it has no slug identity and no `[[slug]]` reference anywhere resolves to it
