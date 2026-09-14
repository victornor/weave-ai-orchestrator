## Purpose

Gives a plugin a durable, isolated place to keep its own data in the workspace database, without
ever touching a core table.

## ADDED Requirements

### Requirement: A plugin's stored data persists and survives a restart

`PluginHost.store` SHALL let a plugin `put`, `get`, `delete`, and `list` (by key prefix) JSON-shaped
values keyed by a string of the plugin's choosing, in the workspace database, and that data SHALL
still be readable after the daemon restarts.

#### Scenario: A stored value survives a restart

- **WHEN** a plugin calls `store.put('service:api', { url: 'https://x' })`
- **AND** the daemon restarts
- **THEN** `store.get('service:api')` on the next load returns `{ url: 'https://x' }`

#### Scenario: A deleted key is gone

- **WHEN** a plugin calls `store.delete('service:api')`
- **THEN** `store.get('service:api')` returns `null`

#### Scenario: List returns matching keys

- **WHEN** a plugin has stored `service:api` and `service:web`
- **AND** calls `store.list('service:')`
- **THEN** the result includes both entries and no others

### Requirement: A plugin's stored data is isolated per plugin and never touches a core table

Two plugins storing under the same key SHALL NOT see or overwrite each other's value. No core
service, tool, or route SHALL read from or write to the plugin data table.

#### Scenario: Two plugins do not collide on the same key

- **WHEN** plugin `a` calls `store.put('config', 1)` and plugin `b` calls `store.put('config', 2)`
- **THEN** plugin `a`'s `store.get('config')` returns `1`
- **AND** plugin `b`'s `store.get('config')` returns `2`

### Requirement: A plugin's stored data is removable in one scoped operation, reachable only by an operator

An operator SHALL be able to remove all of one plugin's stored data without affecting any other
plugin's data or any core table. This operation SHALL require an operator session and SHALL NOT be
reachable through a plugin's own route prefix, a plugin's agent tools, or a plugin page's bridge.

#### Scenario: Purging one plugin's data leaves others intact

- **WHEN** an operator purges plugin `a`'s stored data
- **THEN** every key plugin `a` stored is gone
- **AND** plugin `b`'s stored data is unaffected

#### Scenario: A plugin page cannot trigger the purge

- **WHEN** a plugin's page attempts to reach the purge operation through its page-to-host bridge
- **THEN** the request is rejected without the data being removed
