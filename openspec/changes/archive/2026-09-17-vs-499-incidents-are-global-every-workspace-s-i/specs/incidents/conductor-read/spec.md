## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Incident reads are scoped to the caller's workspace

**Reason**: An incident is a defect report about Weave AI itself, filed by whichever agent hit it, not
the private business of the workspace that happened to file it. Scoping reads to the caller's
workspace meant the one workspace that owns and can fix Weave AI could not see the reports the other
workspaces filed, which inverts the feature's purpose (on 2026-09-17 the weaver reported zero open
incidents while fifteen from other workspaces were open).

**Migration**: None. Every caller that previously saw only its own workspace's incidents plus
workspace-less rows now sees every workspace's incidents; a caller that wants the old view passes
`weave_incident_list`'s `workspaceId` filter for its own workspace. `weave_incident_get` and
`weave_incident_resolve` no longer return `forbidden` for another workspace's incident.

## ADDED Requirements

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
