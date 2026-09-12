# incidents/conductor-read Specification

## MODIFIED Requirements

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
