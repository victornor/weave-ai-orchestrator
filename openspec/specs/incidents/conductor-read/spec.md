# incidents/conductor-read Specification

## Purpose
Lets a conductor list and read back the system incidents agents have filed, through MCP, from every
workspace — so the workspace that owns Weave AI can act on the reports the others file — each
incident tagged with its originating workspace and bounded by time so a repeating routine sees only
what is new. Workers gain no read access.

## Requirements

### Requirement: A conductor can list incidents through MCP

The daemon SHALL expose an MCP tool named `weave_incident_list` to the conductor only. It SHALL return
the incidents matching the given filters newest first as `{ items, total }`, where `total` counts
every incident matching the filters, not just the returned page. It SHALL accept an optional
`reporterKind` filter (`conductor` or `worker`), an optional `limit` (default 100, maximum 200,
matching the daemon-wide HTTP list), an optional `status` filter (`open`, `resolved`, or `all`) that
SHALL default to `open` when omitted, and an optional `workspaceId` filter. With no `workspaceId`, the
tool SHALL return incidents from every workspace, plus rows filed with no workspace at all. With a
`workspaceId`, the tool SHALL return only the incidents filed from exactly that workspace — a
workspace-less row is not filed from it — so a caller can narrow to one workspace deliberately. This
`status` default is specific to `weave_incident_list`: the daemon-wide HTTP list (`GET /api/incidents`,
unaffected by this capability) SHALL continue to return every incident regardless of resolution,
exactly as it did before this capability existed.

#### Scenario: Lists newest first with a total

- **WHEN** a conductor calls `weave_incident_list` with no filters
- **THEN** the result is `{ ok: true, data: { items, total } }` with items ordered newest first
- **AND** `total` is the number of incidents the conductor can see, even when `limit` returns fewer

#### Scenario: Filter by reporter kind

- **WHEN** a conductor calls `weave_incident_list` with `reporterKind: "worker"`
- **THEN** only worker-filed incidents are returned and counted

#### Scenario: Limit bounds the page

- **WHEN** a conductor calls `weave_incident_list` with `limit: 1` while two visible incidents exist
- **THEN** one item is returned and `total` is 2

#### Scenario: The HTTP incidents list keeps showing resolved incidents

- **WHEN** a session client calls `GET /api/incidents` while one open and one resolved incident are visible
- **THEN** both are returned, exactly as if neither had been resolved

#### Scenario: Resolved incidents are hidden by default

- **WHEN** a conductor calls `weave_incident_list` with no `status` filter while one open and one resolved incident are visible
- **THEN** only the open incident is returned and counted

#### Scenario: status "resolved" shows only resolved incidents

- **WHEN** a conductor calls `weave_incident_list` with `status: "resolved"` while one open and one resolved incident are visible
- **THEN** only the resolved incident is returned and counted

#### Scenario: status "all" shows both

- **WHEN** a conductor calls `weave_incident_list` with `status: "all"` while one open and one resolved incident are visible
- **THEN** both incidents are returned and counted

#### Scenario: A second sweep after resolving finds nothing new

- **WHEN** a conductor lists incidents, resolves every one it found, and lists again with no `status` filter
- **THEN** the second list is empty

#### Scenario: Narrowing to one workspace

- **WHEN** incidents were filed from workspace A and workspace B and a conductor lists with `workspaceId` set to A
- **THEN** only A's incidents are returned and counted, and none of B's appears

### Requirement: The incident list is lean by default

`ac_incident_list` SHALL omit the `evidence` field from each item unless the call sets `includeEvidence: true`, mirroring the lean-projection rule for MCP list tools. `ac_incident_get` SHALL always return the full row including `evidence`. The list result SHALL be subject to the same size cap as the other MCP list tools: when its JSON would exceed 64 KiB it SHALL return fewer items with `truncated: true`.

#### Scenario: Default list has no evidence

- **WHEN** a conductor lists incidents without `includeEvidence`
- **THEN** no item carries an `evidence` field

#### Scenario: includeEvidence restores it

- **WHEN** a conductor lists incidents with `includeEvidence: true`
- **THEN** each item carries the stored `evidence`, or `null` when none was filed

#### Scenario: An oversized list is truncated

- **WHEN** a list result's JSON would exceed 64 KiB
- **THEN** the result returns at most 64 KiB with `truncated: true` and a shortened `items` array

#### Scenario: Get returns the full row

- **WHEN** a conductor calls `ac_incident_get` for an incident that has evidence
- **THEN** the result includes that evidence

### Requirement: A conductor can read one incident by id through MCP

The daemon SHALL expose an MCP tool named `ac_incident_get` to the conductor only, taking the incident id. It SHALL return the full stored row. An unknown id SHALL be rejected with `not_found`.

#### Scenario: Read one back

- **WHEN** a conductor calls `ac_incident_get` with the id returned by a successful file
- **THEN** the tool returns `{ ok: true, data: <the stored incident> }` with title, whatFailed, tryingToDo, reporterKind and createdAt

#### Scenario: Unknown id

- **WHEN** a conductor calls `ac_incident_get` with an id that was never filed
- **THEN** the tool returns `{ ok: false, error: { code: "not_found" } }`

### Requirement: Workers cannot read incidents

Neither tool SHALL be available to a worker: a worker's call to `ac_incident_list` or `ac_incident_get` SHALL be rejected with `forbidden`. A worker's ability to file incidents through `ac_incident` SHALL be unchanged.

#### Scenario: A worker cannot list

- **WHEN** a worker calls `ac_incident_list`
- **THEN** the tool returns `{ ok: false, error: { code: "forbidden" } }`

#### Scenario: A worker cannot read one back

- **WHEN** a worker calls `ac_incident_get` with the id of an incident it filed itself
- **THEN** the tool returns `{ ok: false, error: { code: "forbidden" } }`

#### Scenario: A worker can still file

- **WHEN** a worker calls `ac_incident` with a title, whatFailed and tryingToDo
- **THEN** the file succeeds as before and returns an id

### Requirement: The list can be bounded by time

`weave_incident_list` SHALL accept an optional `since` — an ISO-8601 instant — and SHALL return only
incidents created strictly after it, regardless of the reporter, status or workspace filter, or the
limit. A repeating caller that bookmarks the newest `createdAt` it processed and passes it as `since`
SHALL not receive that incident again. An unparseable `since` SHALL be rejected with `validation`.
The instant SHALL be compared after normalizing both sides to the daemon's stored timestamp format,
so a caller may pass instants with or without millisecond precision. Because the ordering the bound
is applied to now spans workspaces, a sweep SHALL be correct across them: an incident newer than the
bound filed from any workspace SHALL be returned, and an incident at or before the bound from any
workspace SHALL not.

#### Scenario: Only newer incidents are returned

- **WHEN** incidents exist at 10:00 and 11:00 and a conductor lists with `since` 10:30
- **THEN** only the 11:00 incident is returned and counted

#### Scenario: The bookmark is not returned again

- **WHEN** a caller lists, then lists again passing the newest `createdAt` from the first page as `since`
- **THEN** that newest incident is absent from the second page

#### Scenario: Precision without milliseconds is safe

- **WHEN** a caller passes `since` as `2026-09-11T00:00:00Z` while incidents exist inside that second
- **THEN** the comparison treats the bound as the exact instant, not as a string prefix

#### Scenario: Unparseable since

- **WHEN** a conductor calls `weave_incident_list` with `since: "yesterday"`
- **THEN** the tool returns `{ ok: false, error: { code: "validation" } }`

#### Scenario: A sweep spans workspaces

- **WHEN** workspace A holds an incident at 10:00 and workspace B holds one at 11:00 and a conductor lists with `since` 10:30
- **THEN** B's 11:00 incident is returned and A's 10:00 incident is not

### Requirement: Filing and the human routes are unchanged

The filing tool `ac_incident`, the session-authenticated routes `GET /api/incidents` and `GET /api/incidents/:id`, and their auth SHALL behave exactly as before this capability: filing stores the same fields, the human's list remains daemon-wide across all workspaces, and run tokens remain rejected on the HTTP routes. The time bound and workspace scoping SHALL NOT be added to the HTTP routes by this change.

#### Scenario: The human's list stays daemon-wide

- **WHEN** a session client calls `GET /api/incidents` after workers in two workspaces filed incidents
- **THEN** both workspaces' incidents are listed, as before

#### Scenario: Filing is unchanged

- **WHEN** an agent files an incident with the same input `ac_incident` accepted before this change
- **THEN** the record is stored with the same fields and the same return shape

### Requirement: Same-millisecond incidents bookmark as a stable group

Incidents that share a `createdAt` millisecond SHALL list as a contiguous newest-first block in reverse creation order. A caller that receives the whole group on one page and then lists again with `since` set to that shared `createdAt` SHALL receive none of the group: the exclusive bookmark neither repeats a row from the group nor drops one that was on that page.

This is the VS-222 paging contract (bookmark the newest `createdAt` after a short page) made safe for a same-millisecond group that fits in the page. A `limit` that splits the group remains a timestamp-cursor limitation and is not changed by this capability.

#### Scenario: A same-millisecond pair is a stable newest-first block

- **WHEN** two incidents are filed in sequence and share a `createdAt` millisecond
- **THEN** listing them newest first returns the later-created incident, then the earlier one
- **AND** listing them again returns the same order

#### Scenario: Bookmarking the group's createdAt drops neither and repeats neither

- **WHEN** two incidents share a `createdAt` and a list with a limit covering both returns both
- **AND** the caller lists again with `since` equal to that `createdAt`
- **THEN** neither incident is in the second page

### Requirement: Incident reads span every workspace

An incident is a defect report about Weave AI itself, so a conductor's incident reads SHALL NOT be
restricted to its own workspace. With no `workspaceId` filter, `weave_incident_list` SHALL return
incidents from every workspace. `weave_incident_get` SHALL return the incident of any workspace by
id; an incident filed from another workspace SHALL NOT be rejected with `forbidden`, and only an
unknown id SHALL be rejected with `not_found`. The reading workspace SHALL NOT be a caller-supplied
input; it comes from the run token and is used only for what a read records, never to restrict what
it returns.

#### Scenario: A conductor reads another workspace's incident

- **WHEN** workspace A filed an incident and a conductor of workspace B lists incidents with no `workspaceId`
- **THEN** A's incident is in the result and counted
- **AND** the conductor of workspace B calling `weave_incident_get` for that incident returns the row

#### Scenario: A workspace-less incident is readable

- **WHEN** an incident was stored with no workspace
- **THEN** every conductor's list includes it and `weave_incident_get` returns it

#### Scenario: An unknown id is still not_found

- **WHEN** a conductor reads an id that was never filed
- **THEN** the tool returns `{ ok: false, error: { code: "not_found" } }`

### Requirement: Every incident read names its originating workspace

Each incident returned by `weave_incident_list` and `weave_incident_get` SHALL carry, in addition to
the stored `workspaceId`, a human-readable name of the workspace it was filed from, so a reader can
tell at a glance where it came from without resolving an opaque id. The name SHALL be the
workspace's configured display name as the daemon knows it when the read is served, not a value
copied into the incident at filing time. An incident stored with no workspace (daemon-global) SHALL
report no name rather than a fabricated one.

#### Scenario: A named origin

- **WHEN** an incident filed from the workspace named "V OFM" is read
- **THEN** the result carries that incident's `workspaceName` as "V OFM" alongside its `workspaceId`

#### Scenario: A daemon-global incident

- **WHEN** an incident stored with no workspace is read
- **THEN** its `workspaceName` is null or absent, and no ULID or empty string is presented as its name

### Requirement: The widening is incidents-only

Widening incident reads to every workspace SHALL NOT widen any other cross-workspace read. Ticket,
decision and knowledge reads SHALL keep their existing workspace and project scoping, and the
session-authenticated incident HTTP routes SHALL keep their current daemon-wide, session-only access.

#### Scenario: Another workspace's ticket stays out of reach

- **WHEN** a conductor in workspace B reads a ticket that belongs to workspace A's database
- **THEN** the ticket is not returned by B's ticket reads

#### Scenario: Knowledge stays scoped

- **WHEN** a conductor in workspace B reads knowledge that belongs to workspace A
- **THEN** B's knowledge reads do not return A's workspace or project knowledge

#### Scenario: The human routes are unchanged

- **WHEN** a session client calls `GET /api/incidents`
- **THEN** it still lists every incident across workspaces, exactly as before this capability existed
