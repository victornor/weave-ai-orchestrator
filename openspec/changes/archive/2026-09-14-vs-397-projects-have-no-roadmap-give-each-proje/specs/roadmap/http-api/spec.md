## Purpose

Serves a project's roadmap over the workspace HTTP API: list, create, update (including reorder,
status and ticket link) and delete, scoped so a caller can only reach the project's own items.

## ADDED Requirements

### Requirement: A project's roadmap is served over scoped HTTP routes

The workspace API SHALL expose a project's roadmap under the project:

- `GET /projects/:id/roadmap` → `{ items: [RoadmapItem] }`, the project's items in order;
- `POST /projects/:id/roadmap` `{ title, notes?, status?, ticketId? }` → **201** `RoadmapItem`, appended;
- `PATCH /projects/:id/roadmap/:itemId` `{ title?, notes?, status?, position?, ticketId? }` → the updated
  `RoadmapItem`; a `position` renumbers the project's items;
- `DELETE /projects/:id/roadmap/:itemId` → `{ ok: true }`.

Every route SHALL resolve the workspace and the named project, and SHALL reject an unknown project as
`not_found`. An `:itemId` naming an item that does not belong to that project SHALL be `not_found`,
so a caller cannot read or write another project's item by id.

#### Scenario: List returns only the project's items in order

- **WHEN** a project has roadmap items
- **THEN** `GET /projects/:id/roadmap` returns them in ascending order
- **AND** items belonging to another project are absent

#### Scenario: Create and update round-trip

- **WHEN** an item is created with `POST`, then its title, status and position are changed with `PATCH`
- **THEN** a subsequent `GET` shows the new values in the requested order

#### Scenario: An item of another project is not reachable

- **WHEN** `PATCH` or `DELETE` names an item id that belongs to a different project
- **THEN** the response is `not_found` and the item is unchanged

#### Scenario: Delete removes the item

- **WHEN** an item is deleted
- **THEN** `GET` no longer lists it

### Requirement: The roadmap routes are documented

`docs/API.md` SHALL describe the roadmap routes, their request and response shapes, and the ordering
and project-scoping rules, alongside the other project routes.

#### Scenario: API.md names the routes

- **WHEN** `docs/API.md` is read under Projects
- **THEN** it documents `GET`/`POST /projects/:id/roadmap` and
  `PATCH`/`DELETE /projects/:id/roadmap/:itemId` and the `RoadmapItem` fields
