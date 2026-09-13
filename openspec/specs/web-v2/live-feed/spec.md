# web-v2/live-feed Specification

## Purpose
One shared trace feed of a worker's current run — the run's event stream and its activity — that
Live, Roles, Chat and a decision card's Watch toggle all render, with a compact variant and
independent expansion state.

## Requirements

### Requirement: One shared worker feed component

V2 SHALL provide a single worker-feed component that renders a worker's current run: its resolved
status, the run's event stream and trace, and its usage. Live, Roles, Chat and the decision card's
Watch toggle SHALL import this component rather than each rendering the run stream themselves, and
all of them SHALL read the same run-event source. When the worker has no run in progress the feed
SHALL fall back to the worker's most recent run rather than rendering nothing.

#### Scenario: Every surface renders the same feed

- **WHEN** Live, Roles, Chat and a held decision card show a worker's run
- **THEN** all four render the shared feed component and the same run-event stream

#### Scenario: A worker between turns

- **WHEN** the worker has no run in progress but has a most recent run
- **THEN** the feed shows that most recent run instead of an empty feed

### Requirement: A compact variant

The feed SHALL offer a compact variant for embedding inside a card or a narrow pane. The compact
variant SHALL preserve the authored indentation of the trace lines, as the full Live feed does, and
SHALL bound its own height and scroll independently of the page around it.

#### Scenario: Compact rendering

- **WHEN** the feed renders in its compact variant
- **THEN** it is sized for the card, scrolls within its own bounds, and keeps each trace line's
  authored indentation

### Requirement: Watch expands the feed in place, independently per card

A decision card whose weaver is holding it SHALL offer a **Watch** toggle that expands the worker's
feed in place beneath the revision row and collapses it again. The expanded-or-collapsed state SHALL
be held per card, so toggling one card's feed does not change any other card's.

#### Scenario: Watch expands in place

- **WHEN** the human activates Watch on a held card
- **THEN** the worker's compact feed appears in place under the revision row and the control offers
  to hide it again

#### Scenario: Independent per card

- **WHEN** two held cards are shown and the human expands the feed on one
- **THEN** only that card's feed is expanded and the other stays collapsed
