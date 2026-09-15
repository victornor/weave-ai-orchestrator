## ADDED Requirements

### Requirement: Block and pending-ticket tools extend the `weave_roadmap_*` family

The daemon SHALL register, in the shared tool-name registry and the server tool registry, reachable
through the same MCP and `POST /agent/tools/:tool` front doors as every other tool, and each
returning the `{ ok, data | error }` envelope without throwing to the caller:

- `weave_roadmap_block_create` `{ projectId, title, notes? }` → the created block, appended;
- `weave_roadmap_block_list` `{ projectId }` → `{ blocks, loose }`, the project's blocks each with
  their ordered items, and its loose items;
- `weave_roadmap_block_update` `{ blockId, title?, notes?, status?, position? }` → the updated block;
- `weave_roadmap_block_start` `{ blockId }` → `{ block, drafts }`;
- `weave_roadmap_item_add` `{ blockId, title, description?, kind?, priority?, roleId?, notes? }` →
  the created item, appended to its block;
- `weave_roadmap_item_update` `{ itemId, title?, description?, kind?, priority?, roleId?, notes?,
  position?, blockId?, ticketId? }` → the updated item; and
- `weave_roadmap_item_merge` `{ itemIds }` → the surviving item with the records of what it absorbed.

Every one of these SHALL be weaver-only; a worker calling any of them SHALL be refused with
`forbidden` without performing the write. Each description SHALL state the bundling intent — that a
block gathers related asks so one worker can do them in one ticket — and `weave_roadmap_block_start`
SHALL say that it returns filing-ready drafts for `weave_ticket_create` rather than creating tickets.

#### Scenario: The block tools are callable

- **WHEN** the weaver calls `weave_roadmap_block_create` for a project and then
  `weave_roadmap_block_list`
- **THEN** the block tool returns `{ ok: true }` with the created block
- **AND** the list returns it with its ordered items

#### Scenario: A worker cannot write blocks or pending tickets

- **WHEN** a worker calls any `weave_roadmap_block_*` or `weave_roadmap_item_*` tool
- **THEN** the call is refused with `forbidden` and the roadmap is unchanged

#### Scenario: The descriptions state the intent

- **WHEN** the tool descriptions are read
- **THEN** the block tools describe gathering and bundling related asks, and the start tool describes
  returning drafts for `weave_ticket_create`

### Requirement: The block and item tools validate their inputs

These tools SHALL reject an empty title, a kind or priority outside its enum, a status other than
`open`, `started` or `dropped` on a block, and starting a `dropped` block, as `validation`. A named
project, block, ticket or role that does not exist, or belongs to another project, SHALL be
`not_found`. `weave_roadmap_item_merge` SHALL refuse fewer than two items, items of different
projects, and any item already linked to a ticket, as `validation`. `weave_roadmap_block_start` SHALL
set the block `started` with its start time and return only its items still without a linked ticket,
so a retry does not refile an item already linked.

#### Scenario: A ticket link stays one write path

- **WHEN** the weaver files a draft and calls `weave_roadmap_item_update` naming that ticket on the
  item
- **THEN** the item is returned with the linked ticket and a later list shows the link

#### Scenario: A foreign ticket is refused

- **WHEN** `weave_roadmap_item_update` names a `ticketId` belonging to another project
- **THEN** the write is refused as `not_found` and the item is unchanged

#### Scenario: Bundling before filing

- **WHEN** the weaver merges two pending tickets and then starts their block
- **THEN** the start returns one draft for the merged item, and the merge's record is on the survivor
