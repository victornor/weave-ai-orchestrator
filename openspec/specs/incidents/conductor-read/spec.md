# incidents/conductor-read Specification

## Purpose
Lets a conductor list and read back the system incidents agents have filed, through MCP, scoped to its own workspace and bounded by time so a repeating routine sees only what is new. Workers gain no read access.

## Requirements

### Requirement: A conductor can list incidents through MCP

The daemon SHALL expose an MCP tool named `ac_incident_list` to the conductor only. It SHALL return
the incidents matching the given filters newest first as `{ items, total }`, where `total` counts
every incident matching the filters, not just the returned page. It SHALL accept an optional
`reporterKind` filter (`conductor` or `worker`), an optional `limit` (default 100, maximum 200,
matching the daemon-wide HTTP list), and an optional `status` filter (`open`, `resolved`, or `all`)
that SHALL default to `open` when omitted. This default is specific to `ac_incident_list`: the
daemon-wide HTTP list (`GET /api/incidents`, unaffected by this capability) SHALL continue to return
every incident regardless of resolution, exactly as it did before this capability existed.

#### Scenario: Lists newest first with a total

- **WHEN** a conductor calls `ac_incident_list` with no filters
- **THEN** the result is `{ ok: true, data: { items, total } }` with items ordered newest first
- **AND** `total` is the number of incidents the conductor can see, even when `limit` returns fewer

#### Scenario: Filter by reporter kind

- **WHEN** a conductor calls `ac_incident_list` with `reporterKind: "worker"`
- **THEN** only worker-filed incidents are returned and counted

#### Scenario: Limit bounds the page

- **WHEN** a conductor calls `ac_incident_list` with `limit: 1` while two visible incidents exist
- **THEN** one item is returned and `total` is 2

#### Scenario: The HTTP incidents list keeps showing resolved incidents

- **WHEN** a session client calls `GET /api/incidents` while one open and one resolved incident are visible
- **THEN** both are returned, exactly as if neither had been resolved

#### Scenario: Resolved incidents are hidden by default

- **WHEN** a conductor calls `ac_incident_list` with no `status` filter while one open and one resolved incident are visible
- **THEN** only the open incident is returned and counted

#### Scenario: status "resolved" shows only resolved incidents

- **WHEN** a conductor calls `ac_incident_list` with `status: "resolved"` while one open and one resolved incident are visible
- **THEN** only the resolved incident is returned and counted

#### Scenario: status "all" shows both

- **WHEN** a conductor calls `ac_incident_list` with `status: "all"` while one open and one resolved incident are visible
- **THEN** both incidents are returned and counted

#### Scenario: A second sweep after resolving finds nothing new

- **WHEN** a conductor lists incidents, resolves every one it found, and lists again with no `status` filter
- **THEN** the second list is empty

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

### Requirement: Incident reads are scoped to the caller's workspace

A conductor's incident reads SHALL be scoped to the filing workspace of the calling run: the list SHALL return only incidents filed from that workspace, plus incidents filed with no workspace at all (daemon-global rows), and `total` SHALL count only those. `ac_incident_get` SHALL return a caller-workspace or workspace-less incident and SHALL reject an incident filed from a different workspace with `forbidden`. The workspace SHALL NOT be a caller-supplied input; it comes from the run token. This scoping applies to the MCP tools only — the session-authenticated HTTP routes remain daemon-wide for the human.

Incidents carry a nullable workspace id; a null means the incident is daemon-global and is visible to every conductor. This is deliberate: an incident is a system-health report, and a row filed with no workspace carries no workspace binding to leak, while rows that do carry a workspace stay inside it.

#### Scenario: A conductor sees its workspace and nothing else

- **WHEN** workspace Alpha has filed two incidents, workspace Beta one, and one more exists with no workspace
- **AND** a conductor of workspace Alpha lists incidents
- **THEN** the result contains exactly Alpha's two incidents and the workspace-less one, and `total` is 3

#### Scenario: Another workspace's incident is invisible to the list

- **WHEN** a conductor of workspace Alpha lists incidents after Beta filed one
- **THEN** no Beta incident appears and `total` does not count it

#### Scenario: Get of another workspace's incident is forbidden

- **WHEN** a conductor of workspace Alpha calls `ac_incident_get` with the id of an incident filed from Beta
- **THEN** the tool returns `{ ok: false, error: { code: "forbidden" } }`

#### Scenario: A workspace-less incident is readable

- **WHEN** a conductor calls `ac_incident_get` with the id of an incident stored with no workspace
- **THEN** the tool returns the row

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

`ac_incident_list` SHALL accept an optional `since` — an ISO-8601 instant — and SHALL return only incidents created strictly after it, regardless of reporter filter or limit. A repeating caller that bookmarks the newest `createdAt` it processed and passes it as `since` SHALL not receive that incident again. An unparseable `since` SHALL be rejected with `validation`. The instant SHALL be compared after normalizing both sides to the daemon's stored timestamp format, so a caller may pass instants with or without millisecond precision.

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

- **WHEN** a conductor calls `ac_incident_list` with `since: "yesterday"`
- **THEN** the tool returns `{ ok: false, error: { code: "validation" } }`

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
