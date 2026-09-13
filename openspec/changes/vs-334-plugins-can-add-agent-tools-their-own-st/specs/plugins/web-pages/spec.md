## Purpose

Lets a plugin add a page to the workspace web app, rendered safely regardless of what the plugin's
own HTML/JS does, plus a nav entry that only appears where the plugin is actually loaded.

## ADDED Requirements

### Requirement: A plugin page renders only for a workspace that loads the plugin

The plugin page route (`/w/:ws/plugins/:pluginId`) SHALL render the plugin's page, sandboxed, for a
workspace that loads that plugin, and SHALL render a not-found state for a workspace that does not.

#### Scenario: The page renders where the plugin is loaded

- **WHEN** workspace `acme` loads a plugin with id `notes` that serves a page
- **THEN** visiting `/w/acme/plugins/notes` renders that plugin's page

#### Scenario: The page does not render where the plugin is not loaded

- **WHEN** workspace `beta` does not load the `notes` plugin
- **THEN** visiting `/w/beta/plugins/notes` renders a not-found state, not the plugin's page

### Requirement: A plugin page runs in an opaque origin with no direct network access

The plugin page SHALL be rendered inside an iframe sandboxed without `allow-same-origin`, and served
with a content-security-policy that blocks outbound network requests from the page itself
(`connect-src 'none'`), regardless of what the plugin's own HTML contains. The page's origin SHALL
therefore never carry the viewer's session cookie and SHALL NOT be able to call any API route
directly.

#### Scenario: The page cannot read the session cookie

- **WHEN** a plugin's page script inspects its own cookies
- **THEN** it does not see the viewer's session cookie

#### Scenario: The page cannot make a direct network request

- **WHEN** a plugin's page script attempts a `fetch` or opens an `EventSource` itself
- **THEN** the content-security-policy blocks it

#### Scenario: The page is rendered inside a sandboxed iframe

- **WHEN** the plugin page route is visited
- **THEN** the page's content is rendered inside an iframe with a `sandbox` attribute that omits
  `allow-same-origin`

### Requirement: A postMessage bridge proxies a plugin page's requests, scoped to its own routes

The host page hosting a plugin's iframe SHALL provide a message-based bridge that: accepts a request
only from that iframe's own `contentWindow`; performs it, authenticated as the viewer's session,
only against that plugin's own route prefix (`/api/w/:ws/plugins/<pluginId>/...`); and rejects a
request whose path would resolve outside that prefix.

#### Scenario: A same-plugin request succeeds through the bridge

- **WHEN** a plugin's page posts a request for one of its own registered routes
- **THEN** the bridge performs it authenticated as the viewer and posts back the result

#### Scenario: A request escaping the plugin's own prefix is rejected

- **WHEN** a plugin's page posts a request whose path is `..`-relative, absolute, or names another
  plugin's id
- **THEN** the bridge rejects it without making any HTTP call

#### Scenario: A request to a sibling administrative route is rejected

- **WHEN** a plugin's page posts a request for a path outside `/api/w/:ws/plugins/<pluginId>/`
  entirely, such as the operator-only plugin data purge route
- **THEN** the bridge rejects it without making any HTTP call

#### Scenario: A message from another window is ignored

- **WHEN** a `message` event arrives whose source is not the hosted iframe's `contentWindow`
- **THEN** the bridge does not act on it

### Requirement: A plugin page receives only its own plugin's live events

The bridge SHALL forward to a subscribed plugin page only `plugin.event` frames whose payload
identifies that same plugin, using the workspace's existing event connection rather than opening a
new one per page.

#### Scenario: A matching event reaches the page

- **WHEN** the workspace's event stream carries a `plugin.event` for the hosted plugin
- **AND** the page has subscribed through the bridge
- **THEN** the page receives it

#### Scenario: Another plugin's event does not reach the page

- **WHEN** the workspace's event stream carries a `plugin.event` for a different plugin
- **THEN** the hosted page does not receive it

### Requirement: A nav entry appears only for a workspace that loads a plugin with a page

The workspace's nav SHALL show an entry linking to a loaded plugin's page only when that workspace
actually loads a plugin that registered one, and SHALL show no such entry otherwise. This SHALL NOT
require adding a build-time route or nav-array entry per plugin.

#### Scenario: The nav entry appears where the plugin is loaded

- **WHEN** workspace `acme` loads the `notes` plugin's page
- **THEN** `acme`'s nav includes an entry linking to `/w/acme/plugins/notes`

#### Scenario: The nav entry is absent where the plugin is not loaded

- **WHEN** workspace `beta` does not load the `notes` plugin
- **THEN** `beta`'s nav has no entry for it

#### Scenario: The existing static nav is unaffected

- **WHEN** no plugin with a page is loaded for a workspace
- **THEN** the workspace's `RAIL`/`TABS`/`MORE_ITEMS` nav renders exactly as it does today
