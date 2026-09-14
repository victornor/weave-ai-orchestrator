# roadmap/weaver-tools Specification

## Purpose
Lets the weaver park, change and remove a project's future ideas from chat, so "put this on the
roadmap" and "remember this for later" land somewhere durable instead of becoming premature tickets.

## Requirements

### Requirement: Four roadmap tools are registered alongside the other `weave_*` tools

The daemon SHALL register `weave_roadmap_list`, `weave_roadmap_add`, `weave_roadmap_update` and
`weave_roadmap_remove` in the shared tool-name registry and the server tool registry, reachable
through the same MCP and `POST /agent/tools/:tool` front doors as every other tool. Each SHALL return
the `{ ok, data | error }` envelope and SHALL NOT throw to the caller.

- `weave_roadmap_list` `{ projectId? }` → `{ items: [RoadmapItem] }`, the project's items in order.
- `weave_roadmap_add` `{ projectId, title, notes?, status?, ticketId? }` → the created `RoadmapItem`.
- `weave_roadmap_update` `{ itemId, title?, notes?, status?, position?, ticketId? }` → the updated
  `RoadmapItem`.
- `weave_roadmap_remove` `{ itemId }` → `{ ok: true }`.

#### Scenario: The tools are callable

- **WHEN** the weaver calls `weave_roadmap_add` with a project and title
- **THEN** the call returns `{ ok: true }` with the created item
- **AND** `weave_roadmap_list` returns it among the project's items

#### Scenario: A failed call is an error, not a throw

- **WHEN** `weave_roadmap_add` is called with an empty title
- **THEN** the result is `{ ok: false, error }` with a `validation` code

### Requirement: Roadmap writes are weaver-only, and a worker may read its own project's roadmap

`weave_roadmap_list` SHALL be available to a worker as well as the weaver, and SHALL be scoped so a
worker sees only its own project's roadmap; the weaver may name any project. `weave_roadmap_add`,
`weave_roadmap_update` and `weave_roadmap_remove` SHALL be weaver-only, and a worker calling one
SHALL be refused with `forbidden` without performing the write.

#### Scenario: A worker reads its own project's roadmap

- **WHEN** a worker calls `weave_roadmap_list` without a project
- **THEN** it receives the items of the project its run belongs to

#### Scenario: A worker cannot read another project's roadmap

- **WHEN** a worker calls `weave_roadmap_list` naming a different project
- **THEN** the call is refused with `forbidden`

#### Scenario: A worker cannot write to a roadmap

- **WHEN** a worker calls `weave_roadmap_add`, `weave_roadmap_update` or `weave_roadmap_remove`
- **THEN** the call is refused with `forbidden` and the roadmap is unchanged

### Requirement: The weaver's write tools validate the project, the ticket link and the item

`weave_roadmap_add` and `weave_roadmap_update` SHALL reject a status outside `idea`, `planned` or
`dropped` and an empty title as `validation`. A named project that does not exist SHALL be
`not_found`. A `ticketId` SHALL name a ticket that exists and belongs to the item's project, or the
write SHALL be refused as `not_found`; the linked ticket SHALL be returned on the item, so the
weaver can confirm what an item became.

#### Scenario: Linking a ticket

- **WHEN** the weaver files a ticket and calls `weave_roadmap_update` naming that ticket on an item
- **THEN** the item is returned with the linked ticket
- **AND** a later `weave_roadmap_list` shows the link

#### Scenario: A ticket from another project is refused

- **WHEN** `weave_roadmap_update` names a `ticketId` belonging to a different project
- **THEN** the write is refused as `not_found` and the item is unchanged
