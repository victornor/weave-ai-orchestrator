# web-v2/shell Specification

## Purpose
V2 is a parallel frontend for the same daemon, reachable at `/v2` while V1 stays at `/`: a
lazy-loaded subtree inside the existing web app, with an addressable page and a header for every V2
destination, an obvious way to move between the two versions, and no effect on V1.

## Requirements

### Requirement: Every V2 destination has a route and a header

The V2 app SHALL provide an addressable route for every destination it navigates to, each rendering
a page with a header that names the destination and its scope. The page body MAY be a placeholder
until the screen ticket that owns it fills the content, but the route, the destination's rail entry
and the header SHALL exist.

The destinations SHALL include the global pages — Needs you, Live, Incidents, Map, Runs, Settings,
Run detail and Global Chats — and the workspace pages — Chat, Needs you, Work, Roles, Knowledge, the
knowledge graph, the knowledge explorer, Usage, Changelog, the project overview, the ticket page,
the artifact reader and the worker page. The merge queue SHALL NOT have a V2 route.

The header SHALL accept an optional screen-supplied action area, so a screen MAY put its own controls
into the same 38px header the frame renders. Supplying actions SHALL NOT change the breadcrumb, the
destination label or the counts: those SHALL still derive from the frame's one source, and a screen
SHALL NOT render a second header above or beside it.

#### Scenario: Each destination resolves

- **WHEN** a user opens any V2 destination's address
- **THEN** the V2 shell renders that destination's page with its header

#### Scenario: A kept V1 screen has a V2 address

- **WHEN** a user opens the V2 Global Chats, project overview, Usage, Changelog, knowledge graph,
  knowledge explorer or worker page address
- **THEN** the V2 shell renders a page for it with its header

#### Scenario: The merge queue has no V2 route

- **WHEN** the V2 route table is inspected
- **THEN** it contains no route for the merge queue, and no V2 rail row or phone list entry links to
  one

#### Scenario: A screen puts its controls in the header

- **WHEN** a screen supplies header actions, such as Usage's window and grain picker
- **THEN** those controls render in the frame's 38px header, beside the label and counts, and the
  label, breadcrumb and counts are unchanged

#### Scenario: A screen without actions

- **WHEN** a screen supplies no header actions
- **THEN** the header renders exactly as before, with the label, breadcrumb and counts

### Requirement: V1 is visually isolated from V2

V2's design tokens and component styles SHALL be scoped to the V2 root so that no V1 element
inherits them. A V1 element SHALL resolve the same token values it resolved before this change
whether or not a V2 page has been visited in the same session.

#### Scenario: V1 tokens outside the V2 root

- **WHEN** a V1 screen is rendered after a V2 page has been visited
- **THEN** its surfaces, text, accent and status colours are V1's own values

#### Scenario: V2 tokens inside the V2 root

- **WHEN** a V2 screen is rendered
- **THEN** tokens resolve to the Mono values of the active V2 theme

#### Scenario: V1's tests still pass

- **WHEN** the existing UI test suite is run
- **THEN** every V1 test passes unchanged

### Requirement: The app is served at the root on the same daemon

The web app SHALL render the V2 shell for every path of the app, served at the root (`/`) on the
same daemon. Serving it SHALL NOT require a new daemon route, HTTP API route, config flag or
migration; the daemon's existing static handler already serves the web app for a path that is not a
built asset, and `/` SHALL resolve through that same handler. The app's scripts and stylesheets
SHALL load from the same built asset directory the daemon already serves.

#### Scenario: Opening the app from a signed-in browser

- **WHEN** a signed-in user opens `/`
- **THEN** the app renders the shell without any daemon change having been made

#### Scenario: A deep link into a page

- **WHEN** a user opens `/w/<workspace>/work` directly, without visiting `/` first
- **THEN** the app renders the shell on that workspace's Work page

#### Scenario: Assets are served

- **WHEN** the shell loads
- **THEN** its scripts, stylesheet and images are served from the build's own asset path, with no
  second static handler

### Requirement: The app answers every address at the root and V1 answers none

No app address SHALL carry a `/v2` prefix: every destination SHALL be reachable at its root path,
and navigating inside the app SHALL build root paths only. The V1 route tree SHALL NOT be mounted,
so no V1-only address renders a V1 screen; the V1 route and shell modules remain in the tree for the
follow-up deletion. The sign-in screen SHALL remain a chromeless sibling of the signed-in shell, at
`/login`, and the shell's own code and styles SHALL still load on first navigation rather than as
part of a V1 entry bundle.

#### Scenario: No address carries the prefix

- **WHEN** the app's route table is inspected
- **THEN** every destination resolves at a root path and none at a `/v2` path

#### Scenario: In-app links stay at the root

- **WHEN** a user follows an in-app link, such as Work's ticket link or the rail's settings row
- **THEN** the resulting address has no `/v2` segment

#### Scenario: A V1-only address renders no V1 screen

- **WHEN** a user opens a V1-only address such as `/w/<workspace>/board`
- **THEN** no V1 screen is rendered

#### Scenario: Sign-in stays chromeless

- **WHEN** a signed-out user opens any app address
- **THEN** the app shows its sign-in at `/login` without the rail

### Requirement: The root resolves a workspace

Opening `/` SHALL resolve within the app: the workspace this device last used when one is remembered,
landing on that workspace's Needs you; when none is remembered and the visitor is signed in,
onboarding; and when the visitor is not signed in, the sign-in screen. A remembered workspace the
daemon no longer reports SHALL be forgotten rather than produce an error.

#### Scenario: A returning device

- **WHEN** a device that last used workspace Acme opens `/`
- **THEN** the app shows Acme's Needs you page and the rail highlights that row

#### Scenario: No workspace remembered

- **WHEN** a signed-in device with nothing remembered opens `/`
- **THEN** the app opens onboarding

#### Scenario: Not signed in

- **WHEN** a device with nothing remembered and no session opens `/`
- **THEN** the app opens the sign-in screen

#### Scenario: A forgotten workspace

- **WHEN** the remembered workspace is no longer reported by the daemon and `/` is opened
- **THEN** the app forgets it and resolves to the first available workspace or onboarding, without
  an error
