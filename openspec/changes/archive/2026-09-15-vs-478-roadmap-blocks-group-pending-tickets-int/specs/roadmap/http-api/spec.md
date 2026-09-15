## ADDED Requirements

### Requirement: A project's roadmap blocks are served over scoped HTTP routes

The workspace API SHALL expose a project's blocks under the project:

- `GET /projects/:id/roadmap/blocks` → `{ blocks: [RoadmapBlock] }`, each block in the project's
  block order and carrying its own items in the project's item order;
- `POST /projects/:id/roadmap/blocks` `{ title, notes? }` → **201** the created `RoadmapBlock`,
  appended to the project's block order;
- `PATCH /projects/:id/roadmap/blocks/:blockId` `{ title?, notes?, status?, position? }` → the
  updated `RoadmapBlock`; a `position` renumbers the project's blocks so the order stays dense, and
  `status` accepts `open`, `started` or `dropped`.

Every route SHALL resolve the workspace and the named project, and SHALL reject an unknown project or
an unknown block as `not_found`. A `:blockId` naming a block that does not belong to that project
SHALL be `not_found`, so a caller cannot read or write another project's block by id. The existing
`GET /projects/:id/roadmap` is unchanged and continues to return all of the project's items, each
now carrying its `blockId`.

#### Scenario: Blocks list with their items

- **WHEN** a project has blocks with items
- **THEN** `GET /projects/:id/roadmap/blocks` returns them in the project's block order, each block's
  items in item order
- **AND** blocks belonging to another project are absent

#### Scenario: Create and update round-trip

- **WHEN** a block is created with `POST`, then its title and position are changed with `PATCH`
- **THEN** a subsequent `GET` shows the new values in the requested order

#### Scenario: A block of another project is not reachable

- **WHEN** `PATCH` names a block id that belongs to a different project
- **THEN** the response is `not_found` and the block is unchanged

### Requirement: The block routes and item fields are documented

`docs/API.md` SHALL describe the block routes and their request and response shapes, the
`RoadmapBlock` fields, the derived `done` status, and the new `RoadmapItem` fields (`blockId`,
`description`, `kind`, `priority`, `roleId`), alongside the existing roadmap subsection.

#### Scenario: API.md names the block routes

- **WHEN** `docs/API.md` is read under Projects
- **THEN** it documents `GET`/`POST /projects/:id/roadmap/blocks` and
  `PATCH /projects/:id/roadmap/blocks/:blockId`, the `RoadmapBlock` fields and the new
  `RoadmapItem` fields
