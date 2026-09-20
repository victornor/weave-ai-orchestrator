## ADDED Requirements

### Requirement: A plan-approval card shows the ticket's plan artifact

When a ticket carries a published plan artifact — the stored ticket document `artifact:plan` that
`weave_ticket_artifact_put` creates — a `plan_approval` card for that ticket SHALL show it: a
labelled control carrying the artifact's title that opens the artifact through the existing
session-authenticated, sandboxed serving route and viewer already used for ticket artifacts. The
artifact SHALL be shown on every surface that renders the plan approval card, including the ticket's
Plan view, and SHALL be the ticket's plan artifact rather than any other artifact the ticket may
carry. Republishing the artifact under the `plan` key SHALL change what the card shows.

Showing the artifact SHALL NOT change the card's options, its weaver-review hold, its document
target, or the way the decision is answered; a card whose ticket has no plan artifact SHALL render
exactly as it does today.

#### Scenario: The plan artifact is shown on the card

- **WHEN** a `plan_approval` card is rendered for a ticket with a published `artifact:plan`
- **THEN** the card offers a labelled control with the artifact's title that opens the artifact in the sandboxed viewer

#### Scenario: The Plan view shows it too

- **WHEN** the ticket's Plan view renders the plan approval card for a ticket with a published `artifact:plan`
- **THEN** the plan artifact is shown there as well, through the same viewer

#### Scenario: The plan artifact wins over another artifact

- **WHEN** a ticket carries more than one artifact work product, including `plan`
- **THEN** the plan-approval card shows the `plan` artifact, not another one

#### Scenario: A republished plan artifact updates the card

- **WHEN** the worker republishes the artifact under the `plan` key while the plan approval is open
- **THEN** the card shows the newest revision's title and opens the newest revision

#### Scenario: Approving and reviewing are unchanged

- **WHEN** a plan approval is answered on a card that shows a plan artifact
- **THEN** the approve, revise and reject options, the weaver review gate and YOLO behave exactly as they do without one

#### Scenario: A ticket with no plan artifact renders as before

- **WHEN** a `plan_approval` card is rendered for a ticket with no stored `artifact:plan`
- **THEN** no artifact control is added and the card renders as it does today
