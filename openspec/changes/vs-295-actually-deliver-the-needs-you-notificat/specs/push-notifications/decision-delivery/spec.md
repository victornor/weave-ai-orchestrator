## Purpose
The moment a decision needs the human is the moment `sendPush` should fire — the same open set the
Needs you page and the unread badge already read from. This is the caller VS-286's scout found
missing: a correct sender with nothing that ever decides to use it.

## ADDED Requirements

### Requirement: Creating a human-owned decision triggers a push

Whenever a decision is created with `owner: 'human'`, the workspace it belongs to SHALL attempt to
deliver a push notification to every subscription registered in that workspace that has the
`decisions` category enabled (`push-notifications/category-preferences`), subject to the daemon
having a configured key pair.

This SHALL cover every decision kind that resolves to human ownership — including at least plan
approval, merge approval, action approval, hire approval, and a `question` or `concern` raised
through `weave_ask` by the conductor — with no per-kind list to keep in sync: the trigger is the
existing `owner: 'human'` decision-creation path, not a hand-maintained set of kinds.

A decision created with `owner: 'weaver'` (a worker's question or concern, a `gate_finding`) SHALL
NOT trigger a push — it was never going to reach a human.

#### Scenario: A plan approval triggers a push

- **WHEN** a ticket's proposal is submitted and a `plan_approval` decision is created with
  `owner: 'human'`, and this workspace has a subscription with `decisions` enabled
- **THEN** `sendPush` is called for that subscription

#### Scenario: A worker's question does not

- **WHEN** a worker raises a `concern` through `weave_ask`, and the decision it creates has
  `owner: 'weaver'`
- **THEN** no push is attempted for it

#### Scenario: Every human-owned kind is covered without a hand-maintained list

- **WHEN** a decision of a kind not explicitly named in this spec (e.g. a future kind) is created
  with `owner: 'human'`
- **THEN** it still triggers a push, because the trigger is the owner, not the kind

### Requirement: The push payload names the decision and opens Needs you on click

The push notification's title and body SHALL be drawn from the decision's own title/context so the
human can tell what it is without opening the app. Its payload SHALL carry a `path` that the existing
service-worker `notificationclick` handler (`packages/ui/public/sw.js`) already reads to focus or
open the app.

Clicking the notification SHALL open (or focus) the app at the workspace's Needs you page — the
surface that already lists every open human-owned decision — without requiring the click handler to
know which specific decision to deep-link to.

#### Scenario: The notification names the decision

- **WHEN** a `merge_approval` decision titled "Merge ACME-12" is created and triggers a push
- **THEN** the delivered notification's title or body mentions "Merge ACME-12"

#### Scenario: Clicking opens Needs you

- **WHEN** the human clicks a delivered decision notification and no app window is open
- **THEN** a new window opens at that workspace's Needs you page

#### Scenario: Clicking focuses an already-open app

- **WHEN** the human clicks a delivered decision notification while the app is already open in
  another tab
- **THEN** that tab is focused rather than a second window being opened

### Requirement: A send failure for one subscription does not block another

Delivering to multiple subscriptions in the same workspace SHALL be independent: one subscription
failing (network error, expired endpoint, rejected key) SHALL NOT prevent delivery to the others, and
SHALL NOT raise an error that stops the decision from being created or the workspace from continuing
to operate.

#### Scenario: One dead subscription does not block a live one

- **WHEN** a workspace has two subscriptions and one endpoint is no longer valid
- **THEN** the other subscription still receives the push

### Requirement: An unconfigured daemon skips delivery without side effects

When the daemon has no VAPID key pair, creating a human-owned decision SHALL proceed exactly as it
does today — the decision is created, `Needs you` and the unread badge behave unchanged — and no push
delivery attempt SHALL be made.

#### Scenario: No key pair, no attempted send

- **WHEN** a human-owned decision is created on a daemon with no VAPID key pair
- **THEN** the decision is created normally and no push send is attempted
