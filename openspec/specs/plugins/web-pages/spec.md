# plugins/web-pages Specification

## Purpose
A plugin can serve its own page inside Weave AI: the daemon serves the plugin's HTML, the app
renders it at `/w/:ws/plugins/:pluginId` in an opaque-origin sandbox with a scoped postMessage
bridge to the plugin's own API routes, a data-driven rail entry reaches it, and the page is styled
by a daemon-generated stylesheet that follows the app's live theme without the plugin shipping any
CSS of its own.

## Requirements

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

### Requirement: A plugin page renders at the root plugin route for a workspace that loads the plugin

The plugin page route, `GET /w/:ws/plugins/:pluginId` in the app, SHALL render the plugin's page,
sandboxed, for a workspace that loads that plugin, and SHALL render a not-found state for a
workspace that does not. It SHALL NOT require adding a route per plugin: it remains one static
route with a dynamic plugin-id segment.

#### Scenario: The page renders where the plugin is loaded

- **WHEN** workspace `acme` loads a plugin with id `notes` that serves a page
- **THEN** visiting `/w/acme/plugins/notes` renders that plugin's page

#### Scenario: The page does not render where the plugin is not loaded

- **WHEN** workspace `beta` does not load the `notes` plugin
- **THEN** visiting `/w/beta/plugins/notes` renders a not-found state, not the plugin's page

### Requirement: A rail entry appears only for a workspace that loads a plugin with a page

The rail (expanded, collapsed and the phone More list) SHALL show an entry linking to a loaded
plugin's page only when that workspace actually loads a plugin that registered one, and SHALL show
no such entry otherwise. This SHALL NOT require adding a build-time route or rail-array entry per
plugin.

#### Scenario: The rail entry appears where the plugin is loaded

- **WHEN** workspace `acme` loads the `notes` plugin's page
- **THEN** `acme`'s rail (expanded and collapsed) and phone More list include an entry linking to
  `/w/acme/plugins/notes`, and that entry is the only one highlighted while that page is shown

#### Scenario: The rail entry is absent where the plugin is not loaded

- **WHEN** workspace `beta` does not load the `notes` plugin
- **THEN** `beta`'s rail has no entry for it

#### Scenario: Two workspaces with different plugins show different rail entries

- **WHEN** workspace `acme` loads a plugin with a page and workspace `beta` loads a different one
- **THEN** each workspace's rail shows only its own plugin's entry, not the other's

#### Scenario: The existing static rail is unaffected

- **WHEN** no plugin with a page is loaded for a workspace
- **THEN** the workspace's rail renders exactly as it does today

#### Scenario: A plugin's declared display name is used where present

- **WHEN** a loaded plugin declares a display name
- **THEN** the rail entry's label and the plugin page's title show that name, not the plugin's id

#### Scenario: The id is the fallback

- **WHEN** a loaded plugin declares no display name
- **THEN** the rail entry's label and the plugin page's title show the plugin's id

### Requirement: The table's metadata cell shrinks and truncates without crowding out the row

The `.v2-table` recipe SHALL style its metadata (`secondary`) cell so it may shrink after the
`primary` cell keeps a minimum width, truncating its own text with an ellipsis and keeping its muted,
monospace look. The cell SHALL NOT wrap its text. At a narrow viewport the `primary` cell and the
`actions` cell SHALL remain visible, and the table and its page SHALL NOT scroll horizontally.

#### Scenario: A long metadata value truncates rather than wrapping

- **WHEN** a row's `secondary` cell holds a value wider than the row at a phone width
- **THEN** the cell's text is truncated with an ellipsis on one line

#### Scenario: The primary cell and the actions stay visible at a phone width

- **WHEN** a row with a long `secondary` value, a `primary` value and an `actions` cell is rendered
  at 390px
- **THEN** the `primary` cell is visible at a non-zero width
- **AND** every button in the `actions` cell is fully inside the viewport

#### Scenario: Short values do not wrap at a wide viewport

- **WHEN** a row with short `primary` and `secondary` values is rendered at 1440px
- **THEN** neither cell wraps to a second line

#### Scenario: An existing page keeps its look where it already fits

- **WHEN** a plugin page written to today's vocabulary is rendered at a width its rows already fit
- **THEN** the row renders as it did before this change

### Requirement: The table recipe includes an inline row panel role

`WEAVE_PLUGIN_CLASS` SHALL include a panel role naming a `v2-*` class, and the `.v2-table` recipe
SHALL style that class as a full row-width region a plugin places after a row inside the table,
divided from the row above exactly as rows are divided from one another. Its form fields SHALL be
laid out with the host's own form-row role, so a plugin opens an edit form under a row without
adding a card or any CSS of its own. The daemon-generated plugin stylesheet SHALL carry the panel
rule, derived from `packages/ui/src/v2/v2.css`.

#### Scenario: The panel class is published and styled

- **WHEN** the SDK's class vocabulary and the generated plugin stylesheet are inspected
- **THEN** the vocabulary names a panel class and the stylesheet contains a rule for it

#### Scenario: A panel divides from its row

- **WHEN** a `.v2-table` contains a row followed by a panel
- **THEN** the panel spans the table's full width
- **AND** a divider separates the row from the panel

#### Scenario: Fields in a panel look like a settings form

- **WHEN** a panel holds the host's form-row role for its fields
- **THEN** the fields render with the host's settings-form label and input layout, with no CSS
  defined by the plugin

### Requirement: The table's actions cell groups small buttons, right-aligned with a consistent gap

The `.v2-table` recipe's `actions` cell SHALL lay out two or more controls as a single right-aligned
group with a consistent gap, SHALL NOT wrap them onto a second line, and SHALL NOT shrink the
controls below their own size. Every control in the group SHALL stay inside the table's width at a
phone viewport.

#### Scenario: A two-button group is right-aligned and evenly spaced

- **WHEN** a row's `actions` cell holds two compact buttons
- **THEN** both buttons sit at the row's trailing edge with the same gap between them
- **AND** neither has wrapped to a second line

#### Scenario: The action group stays on screen at a phone width

- **WHEN** a row with a two-button action group is rendered at 390px
- **THEN** both buttons are fully inside the viewport and the table does not scroll horizontally
