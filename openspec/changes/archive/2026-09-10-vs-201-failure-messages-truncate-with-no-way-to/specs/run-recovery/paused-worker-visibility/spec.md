## ADDED Requirements

### Requirement: The full failure message is reachable from the decision card, bounded for layout

Wherever a decision's context is rendered — the conductor chat's pinned decision area, the Needs You
view, and the global Needs view — the complete stored text SHALL be reachable from that card. A
context short enough to fit the card's normal layout SHALL render inline, in full, with no control. A
context too long to show inline by default SHALL render as a bounded preview with a visible control
that says there is more, and using that control SHALL reveal the complete stored text, including
whatever came after the point the preview stopped. The card's height SHALL stay bounded to its normal
size while collapsed; only expanding it reveals the rest.

#### Scenario: A short context renders in full

- **WHEN** a decision's context fits within the card's default preview
- **THEN** it renders inline in full, with no truncation control

#### Scenario: A long context is collapsed with a visible control

- **WHEN** a decision's context is longer than the card's default preview
- **THEN** the card shows a bounded preview and a visible control indicating there is more

#### Scenario: Expanding shows the complete text, tail included

- **WHEN** the human uses that control on a card whose context was collapsed
- **THEN** the card shows the complete stored context, including content past where the preview
  stopped

#### Scenario: A very long context does not blow up the card

- **WHEN** a decision's context is very long and the card is in its collapsed state
- **THEN** the card's height stays at its normal bound; the full text is shown only once expanded

### Requirement: A ticket shows the open decision that explains why its worker stopped

A ticket whose worker is paused with an open decision raised for that pause SHALL show that decision,
rendered the same way it is everywhere else in this capability, on the ticket's own page — not only
the short "paused · …" summary already shown next to the ticket's status. The summary line is
unaffected by this requirement and continues to exist alongside the decision.

#### Scenario: Opening a ticket with an open worker-failure decision shows it in full

- **WHEN** a human opens the page for a ticket whose worker is paused with an open decision raised for
  that pause
- **THEN** the ticket page shows that decision, and the human can reach its complete text the same way
  they could from the pinned decision area or Needs You

### Requirement: A compact preview of a failure never hides more than it shows

Any single-line preview of a worker's pause reason — the worker card, the ticket card, and the ticket
page's own status-line summary — that is shorter than the underlying message SHALL end with a visible
marker showing it was cut, and SHALL carry the complete underlying message alongside the preview
(for instance, as a tooltip) rather than discarding it once the preview is built. A preview that fits
the full message SHALL show it as-is, with no marker and no different fuller text behind it.

This requirement does not require every compact preview to grow into its own expand control: leading
the human to the full-text view described above is enough.

#### Scenario: A truncated worker-card preview carries the full message

- **WHEN** a worker's pause reason is longer than the worker card's one-line preview
- **THEN** the preview ends with a visible marker, and the full underlying message is attached to that
  preview, not merely the same truncated text repeated

#### Scenario: A short pause reason needs no marker

- **WHEN** a worker's pause reason fits the one-line preview in full
- **THEN** it is shown with no marker, and any text attached alongside it is the same, complete
  message
