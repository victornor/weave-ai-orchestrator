# plugins/web-pages — delta (VS-457)

## MODIFIED Requirements

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

### Requirement: The stylesheet behind the vocabulary is generated from V2's own CSS and served live by the running daemon

The concrete CSS implementing the vocabulary SHALL be produced by the running daemon from
`packages/ui/src/index.css`'s own current content, never hand-authored as a separate literal and
never bundled into the published `@weave-ai/plugin-sdk` package. Restyling
`packages/ui/src/index.css` and shipping a new daemon release SHALL change what every
already-installed plugin page renders, with no change to the plugin's own code and no new
`@weave-ai/plugin-sdk` version.

#### Scenario: The generated stylesheet reflects the app's real tokens

- **WHEN** the daemon generates the plugin stylesheet
- **THEN** its token values are identical to `packages/ui/src/index.css`'s own dark and light token
  blocks

#### Scenario: Every vocabulary item has a rule

- **WHEN** the generated stylesheet is inspected
- **THEN** every class and attribute the vocabulary documents has at least one matching CSS rule in it

#### Scenario: A V2 restyle reaches plugins with no plugin change

- **WHEN** `packages/ui/src/index.css`'s token values change and the daemon is restarted on a build
  that includes the change
- **THEN** a plugin page already installed, unmodified and unrepublished, renders with the new values

#### Scenario: The published package never carries a style value

- **WHEN** `@weave-ai/plugin-sdk` is packed for publishing
- **THEN** its contents include the vocabulary's names and the bridge client logic, and no generated
  CSS or literal style value

### Requirement: The generated stylesheet styles links and the table's action cell

The daemon-generated plugin stylesheet SHALL style prose links — a bare `<a>` and the vocabulary's
`link` class — and the table's `actions` cell role, in both dark and light, derived from
`packages/ui/src/index.css`'s own current rules so a restyle reaches an already-installed plugin
with no plugin change. A plugin page has no `.v2-root` wrapper, so the emitted link rule SHALL NOT
depend on one.

#### Scenario: The generated stylesheet styles a bare link and the link class

- **WHEN** the generated plugin stylesheet is inspected
- **THEN** it contains a rule that styles a bare `<a>` and one that styles `a.v2-link`, both using
  the theme's link token so they follow dark and light

#### Scenario: The generated stylesheet styles the action cell

- **WHEN** the generated plugin stylesheet is inspected
- **THEN** it contains a rule for the table's `actions` cell role

#### Scenario: Every vocabulary item still has a rule

- **WHEN** the generated plugin stylesheet is inspected
- **THEN** every value in `WEAVE_PLUGIN_CLASS` — including `link` — has at least one matching rule,
  exactly as the other roles already do

#### Scenario: The link rule carries no visual literal

- **WHEN** the emitted link rule is inspected
- **THEN** its colour comes from a token the generated stylesheet itself defines, not a literal
  colour value
