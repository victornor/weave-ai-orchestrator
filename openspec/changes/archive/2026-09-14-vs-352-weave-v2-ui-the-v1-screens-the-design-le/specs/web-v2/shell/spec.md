## MODIFIED Requirements

### Requirement: Every V2 destination has a route and a header

The V2 app SHALL provide an addressable route for every destination it navigates to, each rendering
a page with a header that names the destination and its scope. The page body MAY be a placeholder
until the screen ticket that owns it fills the content, but the route, the destination's rail entry
and the header SHALL exist.

The destinations SHALL include the global pages — Needs you, Live, Incidents, Map, Runs, Settings,
Run detail and Global Chats — and the workspace pages — Chat, Needs you, Work, Roles, Knowledge, the
knowledge graph, the knowledge explorer, Usage, Changelog, the project overview, the ticket page,
the artifact reader and the worker page. The merge queue SHALL NOT have a V2 route.

The header SHALL accept an optional screen-supplied action area, so a screen MAY put its own controls
into the same 38px header the frame renders. Supplying actions SHALL NOT change the breadcrumb, the
destination label or the counts: those SHALL still derive from the frame's one source, and a screen
SHALL NOT render a second header above or beside it.

#### Scenario: Each destination resolves

- **WHEN** a user opens any V2 destination's address
- **THEN** the V2 shell renders that destination's page with its header

#### Scenario: A kept V1 screen has a V2 address

- **WHEN** a user opens the V2 Global Chats, project overview, Usage, Changelog, knowledge graph,
  knowledge explorer or worker page address
- **THEN** the V2 shell renders a page for it with its header

#### Scenario: The merge queue has no V2 route

- **WHEN** the V2 route table is inspected
- **THEN** it contains no route for the merge queue, and no V2 rail row or phone list entry links to
  one

#### Scenario: A screen puts its controls in the header

- **WHEN** a screen supplies header actions, such as Usage's window and grain picker
- **THEN** those controls render in the frame's 38px header, beside the label and counts, and the
  label, breadcrumb and counts are unchanged

#### Scenario: A screen without actions

- **WHEN** a screen supplies no header actions
- **THEN** the header renders exactly as before, with the label, breadcrumb and counts
