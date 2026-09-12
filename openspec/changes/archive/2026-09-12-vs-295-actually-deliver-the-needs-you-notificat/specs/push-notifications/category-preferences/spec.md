## Purpose
Settings already shows three notification-category toggles (`decisions`, `landed`, `everything`),
stored only in this browser's `localStorage`. The server has no way to know a device's choice, so
today the toggles filter nothing. This makes the choice real by moving it to the subscription itself,
and is honest about which categories currently have anything to filter.

## ADDED Requirements

### Requirement: A subscription carries its own category selection, stored server-side

`POST /push/subscriptions` SHALL accept the set of categories that subscription wants
(`decisions`, `landed`, `everything`), store it with the subscription row, and use it — not a
client-supplied filter at delivery time — to decide whether that subscription receives a given
category of push.

Omitting the field SHALL default to the same categories the Settings toggles default to
(`decisions` and `landed` on, `everything` off), so a device that has never touched the toggles still
receives what its defaults promise.

Changing a toggle in Settings while already subscribed SHALL update that subscription's stored
categories without requiring the human to unsubscribe and resubscribe.

#### Scenario: A new subscription stores its categories

- **WHEN** a device subscribes with `categories: ['decisions']`
- **THEN** the stored subscription row's categories are exactly `['decisions']`

#### Scenario: Omitting categories uses the toggle defaults

- **WHEN** a device subscribes with no `categories` field
- **THEN** the stored row's categories match the Settings defaults (`decisions`, `landed`)

#### Scenario: Toggling a category updates an existing subscription

- **WHEN** an already-subscribed device turns the `decisions` toggle off in Settings
- **THEN** that device's stored subscription categories no longer include `decisions`, without a new
  subscribe/unsubscribe round trip

### Requirement: Delivery is filtered by the subscription's stored categories

A push of a given category SHALL only be sent to subscriptions whose stored categories include it.
A subscription that has turned a category off SHALL receive no network request for that category —
not a push the client is expected to silently discard.

#### Scenario: A push withheld from an opted-out subscription

- **WHEN** a `decisions`-category push fires and a stored subscription's categories do not include
  `decisions`
- **THEN** no send is attempted to that subscription

#### Scenario: A push delivered to an opted-in subscription

- **WHEN** a `decisions`-category push fires and a stored subscription's categories include
  `decisions`
- **THEN** a send is attempted to that subscription

### Requirement: The Settings UI does not claim a toggle works when nothing sends that category

Only `decisions` has an event source that ever calls `sendPush` as of this change. The `landed` and
`everything` toggles SHALL be labeled so the human can tell they do not yet cause anything to be
sent, rather than appearing identical to a working toggle.

#### Scenario: The decisions toggle is presented as working

- **WHEN** the human views the Notifications section in Settings
- **THEN** the `decisions` row is presented with no qualifier suggesting it is inactive

#### Scenario: The unwired toggles say so

- **WHEN** the human views the `landed` and `everything` rows in Settings
- **THEN** each is labeled to show that nothing is sent under that category yet, even though the
  toggle's own state is saved
