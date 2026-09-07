## MODIFIED Requirements

### Requirement: The overview shows the project's activity and its knowledge

The overview SHALL show the project's changelog: the activity heatmap over the past year and the
newest entries beneath it, the same record the workspace's Changelog view shows, narrowed to this
project.

It SHALL show the project's knowledge: the sections of the project's knowledge file with how much of
its budget it uses, and the project's linked documents, each opening the page that already shows it.

It SHALL also show that project's knowledge health: its documents with no backlink, its documents
not written to in 90 days, and its unresolved `[[links]]`, each entry opening the knowledge area
already scoped to it. A project with none of a given measure SHALL say so rather than omitting it.

#### Scenario: Activity

- **WHEN** a project's overview is shown
- **THEN** its changelog heatmap and its newest changelog entries are shown, for that project only

#### Scenario: Knowledge

- **WHEN** the project has a knowledge file and linked documents
- **THEN** the overview lists its sections and its documents, and each document opens in the
  knowledge area

#### Scenario: An orphan document is shown

- **WHEN** the project has a linked document with no backlink
- **THEN** the overview lists it among the project's knowledge health and opens it from there

#### Scenario: A healthy project's knowledge

- **WHEN** the project has no orphan document, no stale document and no unresolved link
- **THEN** the overview says so for each of those measures instead of omitting them
