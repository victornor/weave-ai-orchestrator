# plugins/web-pages Specification

## Purpose
VS-334 gave plugins a page, storage, tools, routes and a nav entry — but every part of that
contract still assumes V1. The Services plugin (VS-381) is meant to be Weave AI's first real
plugin and the template others build from, built directly for V2, with no styling of its own and
the real SDK. Today it cannot be: V1's `/w/:ws/plugins/:pluginId` route has no V2 counterpart or
rail entry; `host.kitCss()` only returns V1's Artifact Kit CSS, so a plugin page can never look
like V2's Mono theme or follow its live dark/light toggle; and `@weave-ai/plugin-sdk` is not
published anywhere and is workspace-linked only via `pnpm`'s `workspace:*` protocol, so a plugin
living in its own repository (outside this monorepo) cannot `import` it at all without vendoring a
copy that drifts from the daemon it runs against. This change closes those three gaps in Weave AI
itself, so VS-381 (and every plugin after it) needs no workaround.

## Requirements

### Requirement: A plugin page renders only for a workspace that loads the plugin

Both the V1 plugin page route (`/w/:ws/plugins/:pluginId`) and the V2 plugin page route
(`/v2/w/:ws/plugins/:pluginId`) SHALL render the plugin's page, sandboxed, for a workspace that
loads that plugin, and SHALL render a not-found state for a workspace that does not. Neither route
SHALL require adding a route per plugin: both remain one static route with a dynamic plugin-id
segment.

#### Scenario: The page renders where the plugin is loaded (V1)

- **WHEN** workspace `acme` loads a plugin with id `notes` that serves a page
- **THEN** visiting `/w/acme/plugins/notes` renders that plugin's page

#### Scenario: The page renders where the plugin is loaded (V2)

- **WHEN** workspace `acme` loads a plugin with id `notes` that serves a page
- **THEN** visiting `/v2/w/acme/plugins/notes` renders that plugin's page

#### Scenario: The page does not render where the plugin is not loaded (V1)

- **WHEN** workspace `beta` does not load the `notes` plugin
- **THEN** visiting `/w/beta/plugins/notes` renders a not-found state, not the plugin's page

#### Scenario: The page does not render where the plugin is not loaded (V2)

- **WHEN** workspace `beta` does not load the `notes` plugin
- **THEN** visiting `/v2/w/beta/plugins/notes` renders a not-found state, not the plugin's page

### Requirement: A plugin page runs in an opaque origin with no direct network access

The plugin page SHALL be rendered inside an iframe sandboxed without `allow-same-origin`, and served
with a content-security-policy that blocks outbound network requests from the page itself
(`connect-src 'none'`), regardless of what the plugin's own HTML contains, on both the V1 and V2
routes. The page's origin SHALL therefore never carry the viewer's session cookie and SHALL NOT be
able to call any API route directly.

#### Scenario: The page cannot read the session cookie

- **WHEN** a plugin's page script inspects its own cookies
- **THEN** it does not see the viewer's session cookie

#### Scenario: The page cannot make a direct network request

- **WHEN** a plugin's page script attempts a `fetch` or opens an `EventSource` itself
- **THEN** the content-security-policy blocks it

#### Scenario: The page is rendered inside a sandboxed iframe

- **WHEN** either the V1 or the V2 plugin page route is visited
- **THEN** the page's content is rendered inside an iframe with a `sandbox` attribute that omits
  `allow-same-origin`

### Requirement: A postMessage bridge proxies a plugin page's requests, scoped to its own routes

Both the V1 and V2 host pages hosting a plugin's iframe SHALL provide a message-based bridge that:
accepts a request only from that iframe's own `contentWindow`; performs it, authenticated as the
viewer's session, only against that plugin's own route prefix (`/api/w/:ws/plugins/<pluginId>/...`);
and rejects a request whose path would resolve outside that prefix. Both bridges SHALL apply the
same path-resolution rule, so a request accepted or rejected by one is accepted or rejected
identically by the other.

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

The bridge, on both the V1 and V2 routes, SHALL forward to a subscribed plugin page only
`plugin.event` frames whose payload identifies that same plugin, using the workspace's existing
event connection rather than opening a new one per page.

#### Scenario: A matching event reaches the page

- **WHEN** the workspace's event stream carries a `plugin.event` for the hosted plugin
- **AND** the page has subscribed through the bridge
- **THEN** the page receives it

#### Scenario: Another plugin's event does not reach the page

- **WHEN** the workspace's event stream carries a `plugin.event` for a different plugin
- **THEN** the hosted page does not receive it

### Requirement: A nav entry appears only for a workspace that loads a plugin with a page

Both V1's workspace nav and V2's rail (expanded, collapsed and the phone More list) SHALL show an
entry linking to a loaded plugin's page only when that workspace actually loads a plugin that
registered one, and SHALL show no such entry otherwise. This SHALL NOT require adding a build-time
route or nav-array/rail-array entry per plugin.

#### Scenario: The nav entry appears where the plugin is loaded (V1)

- **WHEN** workspace `acme` loads the `notes` plugin's page
- **THEN** `acme`'s nav includes an entry linking to `/w/acme/plugins/notes`

#### Scenario: The rail entry appears where the plugin is loaded (V2)

- **WHEN** workspace `acme` loads the `notes` plugin's page
- **THEN** `acme`'s V2 rail (expanded and collapsed) and phone More list include an entry linking to
  `/v2/w/acme/plugins/notes`, and that entry is the only one highlighted while that page is shown

#### Scenario: The nav entry is absent where the plugin is not loaded

- **WHEN** workspace `beta` does not load the `notes` plugin
- **THEN** neither `beta`'s V1 nav nor its V2 rail has an entry for it

#### Scenario: Two workspaces with different plugins show different rail entries

- **WHEN** workspace `acme` loads a plugin with a page and workspace `beta` loads a different one
- **THEN** each workspace's V2 rail shows only its own plugin's entry, not the other's

#### Scenario: The existing static nav/rail is unaffected

- **WHEN** no plugin with a page is loaded for a workspace
- **THEN** the workspace's V1 `RAIL`/`TABS`/`MORE_ITEMS` nav and V2's `V2_EVERYWHERE`/`V2_WORKSPACE`/
  `V2_KEPT` rail render exactly as they do today

#### Scenario: A plugin's declared display name is used where present

- **WHEN** a loaded plugin declares a display name
- **THEN** the V2 rail entry's label and the plugin page's title show that name, not the plugin's id

#### Scenario: The id is the fallback

- **WHEN** a loaded plugin declares no display name
- **THEN** the V2 rail entry's label and the plugin page's title show the plugin's id

### Requirement: A plugin page is styled through a small, versioned, visual-value-free vocabulary

A plugin page SHALL be styled using a small, documented, versioned set of class names and data
attributes — for a page's base chrome, a section, a table, a badge/status, a button, an input and a
form row, plus theme selection — published as part of `@weave-ai/plugin-sdk`. Neither the vocabulary
nor any part of `@weave-ai/plugin-sdk` SHALL contain a colour, spacing, radius or font value: the
vocabulary names classes and attributes only, and changing it is the only thing that changes that
package's own version with respect to styling.

#### Scenario: The vocabulary carries no visual values

- **WHEN** `@weave-ai/plugin-sdk`'s published contents are inspected
- **THEN** no colour, spacing, radius or font-size value appears anywhere in the package

#### Scenario: A plugin page written to the vocabulary needs no CSS of its own

- **WHEN** a plugin's page markup uses only the documented vocabulary's classes and attributes,
  and includes the standard client bootstrap script
- **THEN** the page renders styled, without the plugin defining or inlining any CSS rule itself

### Requirement: The stylesheet behind the vocabulary is generated from V2's own CSS and served live by the running daemon

The concrete CSS implementing the vocabulary SHALL be produced by the running daemon from
`packages/ui/src/v2/v2.css`'s own current content, never hand-authored as a separate literal and
never bundled into the published `@weave-ai/plugin-sdk` package. Restyling `packages/ui/src/v2/
v2.css` and shipping a new daemon release SHALL change what every already-installed plugin page
renders, with no change to the plugin's own code and no new `@weave-ai/plugin-sdk` version.

#### Scenario: The generated stylesheet reflects the app's real tokens

- **WHEN** the daemon generates the plugin stylesheet
- **THEN** its token values are identical to `packages/ui/src/v2/v2.css`'s own dark and light token
  blocks

#### Scenario: Every vocabulary item has a rule

- **WHEN** the generated stylesheet is inspected
- **THEN** every class and attribute the vocabulary documents has at least one matching CSS rule in it

#### Scenario: A V2 restyle reaches plugins with no plugin change

- **WHEN** `packages/ui/src/v2/v2.css`'s token values change and the daemon is restarted on a build
  that includes the change
- **THEN** a plugin page already installed, unmodified and unrepublished, renders with the new values

#### Scenario: The published package never carries a style value

- **WHEN** `@weave-ai/plugin-sdk` is packed for publishing
- **THEN** its contents include the vocabulary's names and the bridge client logic, and no generated
  CSS or literal style value

### Requirement: The host pushes the stylesheet and the live theme; the client applies both automatically

Because a plugin page's iframe permits no outbound network request of its own, the app (not the
plugin page) SHALL fetch the generated stylesheet and push it, together with the current theme, into
the plugin's page over the postMessage bridge as soon as the page is available; the theme SHALL be
pushed again on every later change. The bridge client every plugin page includes SHALL apply both
automatically — injecting the stylesheet and setting the theme — without the plugin's own code
calling anything. The V1 route is unaffected: it carries neither message, the same as before this
change.

#### Scenario: The page is styled and themed on load with no plugin code

- **WHEN** a V2 plugin page's iframe becomes available, and the plugin's page includes only the
  standard bridge client script
- **THEN** the page is fully styled and shows the app's current theme, with no callback the plugin
  registered

#### Scenario: The page learns of a live theme change

- **WHEN** the app's V2 theme is switched while a plugin page is open
- **THEN** the page's appearance updates to the new theme without the page being reloaded

#### Scenario: An optional first-paint inline stays consistent

- **WHEN** a plugin's own page-serving code inlines `host.themeCss()`'s returned CSS for its first
  paint
- **THEN** that CSS is identical to what the bridge subsequently pushes

#### Scenario: V1 is unchanged

- **WHEN** a plugin page is opened through the V1 route
- **THEN** neither a stylesheet nor a theme message is sent

### Requirement: The vocabulary includes a link role and a table action-cell role

`WEAVE_PLUGIN_CLASS` SHALL include a `link` role, and the table recipe's cell roles SHALL include
an `actions` role for inline per-row controls, both published by `@weave-ai/plugin-sdk` and carrying
no colour, spacing, radius or font value. A plugin SHALL name the action role through the SDK's
exported cell-role constant rather than spelling its attribute value itself.

#### Scenario: The link role is published

- **WHEN** `WEAVE_PLUGIN_CLASS` is read from `@weave-ai/plugin-sdk`
- **THEN** it has a `link` member naming a `v2-*` class, and the object still contains no colour,
  spacing, radius or font value

#### Scenario: The action-cell role is published

- **WHEN** the SDK's table cell-role constant is read
- **THEN** it names an `actions` role, alongside the existing primary and secondary roles

#### Scenario: A plugin needs no CSS for a link or a row action

- **WHEN** a plugin's page markup uses the `link` class for an anchor, or a `actions`-role cell
  holding `.v2-button`s, and includes the standard client bootstrap script
- **THEN** the page renders styled, without the plugin defining or inlining any CSS rule itself

### Requirement: The generated stylesheet styles links and the table's action cell

The daemon-generated plugin stylesheet SHALL style prose links — a bare `<a>` and the vocabulary's
`link` class — and the table's `actions` cell role, in both dark and light, derived from
`packages/ui/src/v2/v2.css`'s own current rules so a V2 restyle reaches an already-installed plugin
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
