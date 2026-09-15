# web-v2/shell — delta

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: V2 is served at `/v2` on the same daemon

**Reason**: The app is promoted to the root, so there is no `/v2` address. Replaced by `The app is
served at the root on the same daemon`.

**Migration**: `/v2/*` redirects to the same path without the prefix.

### Requirement: V2 loads lazily and leaves V1's address alone

**Reason**: V1's address is retired with the promotion; there is one frontend. Replaced by `The app
answers every address at the root and V1 answers none`.

**Migration**: None; the V1 routes are unmounted and every old address redirects or loads directly.

### Requirement: The V2 root resolves a workspace the way V1 does

**Reason**: The root now resolves within the app itself; V1 no longer serves `/`. Replaced by `The
root resolves a workspace`.

**Migration**: None; `/` resolves the remembered workspace, onboarding or sign-in as before.

### Requirement: One click moves between V1 and V2

**Reason**: There is one frontend after the promotion. V1's routes are no longer mounted and answer
no address, so a control that opened V1 at `/` would open the promoted app itself and a control that
opened V2 at `/v2` would open a retired address.

**Migration**: None for a user. The V1 shell's "V2 preview" control and its two test assertions are
removed with the prefix; the follow-up ticket deletes the rest of the V1 shell.
