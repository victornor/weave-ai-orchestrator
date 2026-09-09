## ADDED Requirements

### Requirement: A conductor chat card shows when the conductor filed the ticket itself

In the conductor chat's decisions list — the pinned-open cards and the answered cards shown in the
conversation — a decision card that concerns a ticket SHALL show a small tag saying the ticket was
filed by the conductor when that ticket was created by the conductor on its own initiative rather
than at the human's request. A decision whose ticket was created by the human, or a decision that
concerns no ticket, SHALL show no such tag.

This requirement governs the conductor chat's decisions list only. A decision card shown on any
other surface — `Needs you`, a ticket's own page, or anywhere else a card is rendered — is
unaffected.

#### Scenario: The conductor filed the ticket

- **WHEN** a decision card in the conductor chat's decisions list concerns a ticket the conductor
  created on its own initiative
- **THEN** the card shows a tag saying the ticket was filed by the conductor

#### Scenario: The human filed the ticket

- **WHEN** a decision card in the conductor chat's decisions list concerns a ticket the human
  created, or asked the conductor to create
- **THEN** the card shows no provenance tag

#### Scenario: No ticket at all

- **WHEN** a decision card in the conductor chat's decisions list concerns no ticket
- **THEN** the card shows no provenance tag

#### Scenario: Other surfaces are unaffected

- **WHEN** the same decision is shown in `Needs you` or on its ticket's own page
- **THEN** no provenance tag is shown there, whatever the card in the chat shows

### Requirement: A plan-approval card shows a one-line reminder of what its ticket is for

A ticket SHALL be able to carry a short, one-line summary, set when it is created or at any time
afterwards, independent of its full description. Setting it SHALL NOT require a model call, and
nothing about rendering a card that shows it SHALL require one either.

A `plan_approval` decision card in the conductor chat's decisions list SHALL show that ticket's
summary, when it has one, as a one-line reminder of what the ticket is for, so the human can decide
without opening the ticket. A `plan_approval` card for a ticket with no summary SHALL show no such
line — never a heading, a quoted fragment, or any other text derived from the ticket's full
description in its place.

This requirement governs the conductor chat's decisions list only; other surfaces that render a
`plan_approval` card are unaffected.

#### Scenario: A ticket with a summary

- **WHEN** a `plan_approval` decision card in the conductor chat's decisions list concerns a ticket
  that has a one-line summary
- **THEN** the card shows that summary as a single line

#### Scenario: A ticket with no summary

- **WHEN** a `plan_approval` decision card in the conductor chat's decisions list concerns a ticket
  that has no summary
- **THEN** the card shows no summary line, and nothing derived from the ticket's description takes
  its place

#### Scenario: Setting a summary after the ticket was created

- **WHEN** a ticket that was created before it had a summary is given one afterwards
- **THEN** a `plan_approval` card for that ticket shows the summary from then on

### Requirement: The conductor chat renders a decision card compactly

A decision card in the conductor chat's decisions list SHALL be rendered with less padding, tighter
vertical spacing between its sections, and a smaller button footprint than the same card would take
on any other surface, while showing every field the card shows on those other surfaces. No
information the card carries SHALL be moved behind an expander, a "show more" control, or any other
mechanism that hides it by default, as a way of achieving this.

Every action a card offers SHALL remain reachable with a single tap and SHALL NOT be sized below
what a reliable tap on a handheld touch screen needs.

#### Scenario: A plan-approval card in the chat is more compact

- **WHEN** a `plan_approval` decision card is shown in the conductor chat's decisions list
- **THEN** it shows the same title, context, task list, summary line and actions as the same card
  would show elsewhere, in less vertical space

#### Scenario: Nothing is hidden to save space

- **WHEN** a decision card is rendered compactly in the conductor chat
- **THEN** no field it would otherwise show is moved behind an expander or a "show more" control

#### Scenario: Other surfaces keep their current layout

- **WHEN** the same decision is shown in `Needs you` or on its ticket's own page
- **THEN** it is rendered exactly as it was before this change

#### Scenario: Actions stay reachable on a phone

- **WHEN** a decision card is rendered compactly and viewed at a phone width
- **THEN** every action it offers is still reachable with a single tap at a size fit for a touch
  screen
