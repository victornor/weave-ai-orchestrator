# push-notifications/vapid-keys Specification

## Purpose
The daemon owns the VAPID key pair that signs its web push messages: it generates one the first
time it is needed, keeps the private half out of every human-editable or human-visible surface, and
survives a `daemon upgrade` without regenerating.

## Requirements

### Requirement: The daemon generates its own VAPID key pair on first need

A daemon with no VAPID key pair yet SHALL generate one itself the first time it is needed, without
requiring an operator to supply one and without failing the request or startup that needed it.

Once generated, the same key pair SHALL be reused by every later start of the same daemon
installation — a `daemon upgrade` (a new release directory, the same config/state directory) SHALL
NOT generate a new pair while the old one is still present.

#### Scenario: A fresh daemon generates a pair before it is needed

- **WHEN** a daemon with no prior state starts and the web app asks `GET /push/config`
- **THEN** the response reports `configured: true` with a `vapidPublicKey`, and the same public key
  is returned on every subsequent call for the life of that installation

#### Scenario: An upgrade keeps the same pair

- **WHEN** a daemon that has already generated a key pair goes through `daemon upgrade`
- **THEN** the daemon that comes back up reports the same `vapidPublicKey` as before, and every
  subscription registered against the old pair still receives pushes signed with it

### Requirement: The private key never lands in a human-editable, logged, or transcribed surface

The VAPID private key SHALL NOT appear in `workspace.yaml`, in `daemon.yaml`, in any structured or
unstructured log line, or in any run transcript an agent or human can read. It SHALL NOT be
reachable through any HTTP route, including routes that otherwise return daemon configuration.

The public key MAY appear in daemon configuration and in the `GET /push/config` response — it is not
secret.

#### Scenario: Nothing but the sender ever holds the private key

- **WHEN** the daemon's VAPID key pair is generated and used to send a push
- **THEN** grepping the daemon's log output, `daemon.yaml`, and every workspace's `workspace.yaml`
  for the private key value finds nothing

#### Scenario: A config-reading route never echoes the private key

- **WHEN** any route that returns daemon configuration is called
- **THEN** its response contains at most the public key, never the private one

### Requirement: A daemon with no key pair still starts, serves, and reports push as unconfigured

Before a key pair exists (or if key generation itself fails), the daemon SHALL still start and serve
every other route normally. `GET /push/config` SHALL report `configured: false` and
`vapidPublicKey: null` rather than erroring. `sendPush` SHALL return `{ sent: 0, skipped: <count> }`
rather than throwing.

#### Scenario: Key generation failing does not take down the daemon

- **WHEN** the daemon cannot write its key material (e.g. an unwritable config directory) at startup
- **THEN** the daemon still starts and serves, `GET /push/config` reports `configured: false`, and no
  request crashes because of it

### Requirement: A lost or regenerated key pair invalidates existing subscriptions instead of failing forever

If the daemon's stored key pair is ever regenerated (the encrypted key material is deleted or
becomes unreadable, so a fresh pair is generated in its place), every subscription registered
against the old pair SHALL stop being silently retried forever: a send that the push service rejects
as using an unrecognized key SHALL cause the daemon to drop that subscription, not log the same
failure on every future decision indefinitely.

#### Scenario: A rejected subscription is removed, not retried forever

- **WHEN** the daemon's key pair changes and a stored subscription was registered against the old
  one, and a subsequent push to it is rejected as invalid
- **THEN** the daemon deletes that subscription row and does not attempt to send to it again
