# plugins/web-pages — delta

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: A plugin page renders only for a workspace that loads the plugin

**Reason**: The requirement named two routes — V1's `/w/:ws/plugins/:pluginId` and V2's
`/v2/w/:ws/plugins/:pluginId`. The promotion drops the prefix, so the two collapse into the single
root route; the requirement is restated as `A plugin page renders at the root plugin route for a
workspace that loads the plugin`.

**Migration**: None for a plugin. The retired `/v2/w/:ws/plugins/:pluginId` address redirects to
`/w/:ws/plugins/:pluginId` through the app's redirect layer.

### Requirement: A nav entry appears only for a workspace that loads a plugin with a page

**Reason**: The requirement named V1's workspace nav and V2's rail separately, with V2's entry at
`/v2/w/acme/plugins/notes`. After the promotion there is one nav, and the entry is at
`/w/acme/plugins/notes`; the requirement is restated as `A rail entry appears only for a workspace
that loads a plugin with a page`.

**Migration**: None. The single rail entry addresses the root plugin route.
