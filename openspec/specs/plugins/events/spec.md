# plugins/events Specification

## Purpose
Lets a plugin put its own events on the workspace's existing live stream, so its page can update
live without a new transport.

## Requirements

### Requirement: A plugin can emit a durable, workspace-scoped event

`PluginHost.emit(kind, entityId, payload)` SHALL record a `plugin.event` on the workspace's event
outbox, carrying the emitting plugin's id, and that event SHALL be delivered to the workspace's
existing event stream.

#### Scenario: An emitted event reaches the event stream

- **WHEN** a plugin calls `host.emit('service.updated', 'svc-1', { status: 'up' })`
- **THEN** a client subscribed to that workspace's event stream receives a `plugin.event` whose
  payload identifies the emitting plugin and carries `kind: 'service.updated'` and the given payload

#### Scenario: A plugin event from one workspace does not appear in another

- **WHEN** a plugin emits an event while loaded for workspace `acme`
- **THEN** a client subscribed to workspace `beta`'s event stream does not receive it
