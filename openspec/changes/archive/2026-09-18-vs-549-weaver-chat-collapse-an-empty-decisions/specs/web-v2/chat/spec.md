## REMOVED Requirements

### Requirement: The decisions pane is present whenever the layout is split

**Reason**: The requirement mandates the opposite of what this change builds — an empty decisions pane
must hold its full column whenever the chat region is wide enough to split. It is being replaced by a
requirement that the pane collapses when nothing is waiting while staying reachable and following the
live open-decision count. The requirement's own block ("The pane SHALL NOT appear or vanish as the
number of open decisions changes") is exactly the behavior being removed, so the block is removed and
re-added in its new form rather than silently rewritten.

**Migration**: None for callers. `data-decisions-pane` still marks the right region on desktop; it is
now present in a collapsed state too, carrying a collapsed marker, and the pane's full content renders
only when expanded. The split threshold and the divider's 300–560px bounds are unchanged.

## ADDED Requirements

### Requirement: The decisions pane collapses when nothing is waiting and stays reachable

On desktop — a chat region at least as wide as the split threshold — when no decision is open and the
reader has not deliberately expanded it, Chat SHALL render the decisions pane collapsed to a narrow
right rail rather than holding its full column, and the conversation SHALL take the width the pane
gives up. The collapsed rail SHALL offer a visible, keyboard-operable control that expands the pane
again, so that a collapsed pane is never unreachable, and the expanded pane SHALL offer a control that
collapses it again while nothing is waiting.

The collapse SHALL follow the number of open decisions currently held, never a snapshot taken when the
chat opened: an open decision that appears while the chat is rendered SHALL expand the pane to its
full width without a reload, and answering the last open decision SHALL return the pane to its
collapsed state on its own. A pane the reader expanded by hand while nothing was waiting SHALL remain
expanded until they collapse it or until an open decision arrives and is afterwards answered.

The width change SHALL be animated through the chat's existing motion durations, so the conversation
does not reflow abruptly, and SHALL become an instant step when the reader has asked for reduced
motion. Below the split threshold, and on a phone, neither the pane nor a collapsed rail SHALL render,
exactly as before.

#### Scenario: Nothing waiting on a wide screen

- **WHEN** the chat region is at least as wide as the split threshold and no decision is open
- **THEN** the decisions pane is rendered collapsed to its narrow rail, the conversation takes the
  reclaimed width, and the rail's expand control is present

#### Scenario: A decision arriving expands the pane without a reload

- **WHEN** the chat is rendered on a wide screen with the pane collapsed and an open decision arrives
- **THEN** the pane expands to its full width and shows the decision, without the page reloading

#### Scenario: The last decision answered collapses the pane again

- **WHEN** the last open decision is answered on a wide screen
- **THEN** the pane returns to its collapsed rail on its own, and the conversation takes the reclaimed
  width

#### Scenario: A deliberately expanded empty pane stays reachable

- **WHEN** the chat is on a wide screen with no decision open and the reader activates the rail's
  expand control
- **THEN** the pane expands and shows its empty state, and activating the pane's collapse control
  returns it to the rail

#### Scenario: The collapse follows the count, not the mount

- **WHEN** the chat opens with no decisions, a decision then arrives, and it is answered
- **THEN** the pane is collapsed at first, expands when the decision arrives, and collapses again when
  it is answered — all without a reload

#### Scenario: Below the threshold there is no pane and no rail

- **WHEN** the chat region narrows below the split threshold
- **THEN** neither the decisions pane nor the collapsed rail is rendered and the conversation takes
  the width, as before

#### Scenario: Phone chat is unchanged

- **WHEN** Chat is opened at phone width
- **THEN** no decisions pane and no collapsed rail are rendered, and an open decision renders inline in
  the conversation as before

#### Scenario: Reduced motion collapses the animation

- **WHEN** the reader has asked for reduced motion and the pane changes between its collapsed and
  expanded states
- **THEN** the change is an instant step rather than an animated width transition
