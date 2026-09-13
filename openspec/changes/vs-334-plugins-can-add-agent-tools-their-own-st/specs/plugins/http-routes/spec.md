## Purpose

Lets a plugin serve its own HTTP endpoints under the workspace's API, reachable only by the same
session auth every other workspace route already requires.

## ADDED Requirements

### Requirement: A plugin route is mounted under the workspace and reachable only with auth

`PluginHost.registerHttpRoute(method, path, handler)` SHALL make `handler` reachable at
`/api/w/:ws/plugins/<pluginId><path>` in every workspace that loads the plugin, and that path SHALL
require the same session authentication as any other `/api/w/:ws/*` route.

#### Scenario: An authenticated request reaches the handler

- **WHEN** a plugin registers `GET /services` and is loaded for workspace `acme`
- **AND** a request arrives at `/api/w/acme/plugins/<pluginId>/services` with a valid session
- **THEN** the plugin's handler runs and its response is returned

#### Scenario: An unauthenticated request is rejected before reaching the handler

- **WHEN** the same request arrives with no valid session or run token
- **THEN** the response is `401`
- **AND** the plugin's handler never runs

#### Scenario: A plugin route is absent for a workspace that doesn't load the plugin

- **WHEN** the plugin is loaded only for workspace `acme`, not `beta`
- **THEN** `/api/w/beta/plugins/<pluginId>/services` returns `404`

### Requirement: A throwing route handler returns an error without affecting other requests

A plugin route handler that throws SHALL result in a `5xx` response to that request only; it SHALL
NOT crash the daemon process or affect a concurrent request to a different route.

#### Scenario: A throwing handler degrades to an error response

- **WHEN** a plugin route handler throws
- **THEN** the HTTP response is a server error
- **AND** a subsequent request to a different route succeeds normally
