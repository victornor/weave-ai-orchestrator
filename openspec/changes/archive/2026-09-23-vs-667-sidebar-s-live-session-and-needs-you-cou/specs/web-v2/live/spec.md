## MODIFIED Requirements

### Requirement: The rail's Live badge and the floor's figure are one derivation

The number the rail shows beside Live SHALL be computed from the same working set and the same
derivation as the Live floor's roster figure, so the badge and the floor it points to cannot
disagree by construction. The badge SHALL count the same working set the floor labels running —
including a worker held in the between-turns handover grace — and SHALL reach that figure from the
worker events the document receives, without the Live page being opened.

Every change to whether a worker is live SHALL be observable to the document's live connections:
starting or finishing a turn, being provisioned, resumed, paused, retired, cut off by a daemon
restart or killed by the watchdog SHALL each reach a subscriber as an event naming that worker's
workspace. A transition that changes a worker's live-readiness without emitting such an event is a
defect, because the badge can then only correct itself when another read happens to refresh.

#### Scenario: The badge equals the floor's roster figure

- **WHEN** the Live floor is scoped Everywhere and renders its roster figure
- **THEN** the rail's Live badge equals the number of floor cards that read working

#### Scenario: Two workspaces

- **WHEN** a worker is working in workspace Alpha and another in workspace Beta
- **THEN** the rail's Everywhere Live badge and the floor's roster figure both count two, and each workspace's own rail row counts only its own worker

#### Scenario: A worker inside the handover grace

- **WHEN** a worker's turn just ended and it is still held in the working group
- **THEN** the rail's Live badge and the floor's roster figure both count it, and both drop it once the grace elapses

#### Scenario: A worker in another workspace lifts the badge

- **WHEN** a worker starts in a workspace other than the one the app is showing
- **THEN** the rail's Live badge rises without the Live page being opened

#### Scenario: A turn ending drops the badge

- **WHEN** a worker's turn ends and it does not start another inside the handover grace
- **THEN** the rail's Live badge drops that worker without the Live page being opened and without a page reload

#### Scenario: A worker recovered without its own status write still counts

- **WHEN** a daemon restart or the watchdog returns a worker to work, and that recovery emits no worker-status event
- **THEN** the rail's Live badge still converges to the worker's real state from the events the document receives

#### Scenario: A summary frame alone does not inflate the badge

- **WHEN** the document receives a live-only worker summary frame for a workspace while the app is on a global page
- **THEN** the rail's Live badge counts only workers whose read says they are working, and the extra frame neither invents a worker nor double-counts one