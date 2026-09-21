## ADDED Requirements

### Requirement: An expanded ticket chip shows a bounded live feed inline

Under the ticket-status strips specified by `conductor-chat/dispatch-labels`, an expanded chip's
panel SHALL render inside the message's own block, directly beneath the chip row, at the message's
width.

The panel SHALL be capped at about ten text lines and SHALL hold its own scroll inside that cap, so
long content scrolls in the panel and never scrolls the chat. A feed shorter than the cap SHALL
render at its content height — about six to ten lines is the intended range with content — and SHALL
never be a tall empty box.

The panel SHALL follow its newest content while the reader is at its bottom, through the shared
element-scoped follow the chat and the ticket modal already use in its contained mode — the panel
moves its own scroll offset only — and SHALL pause the follow when the reader scrolls up inside it.
New content arriving in the panel SHALL NOT move the chat; a reader at the bottom of the chat SHALL
be kept there by the chat's existing follow as the message block grows.

Expanding or collapsing a panel SHALL grow or shrink the message block by the panel's height alone,
without a layout jump and without shifting a reader who has scrolled up. The closing transition when
a panel auto-collapses SHALL be short and calm, and SHALL be skipped under reduced motion.

The panel SHALL render wherever the strip renders — the Chat screen and each pane of the global chats
— and SHALL NOT be rendered in a planner chat or in a worker/session transcript. On a phone viewport
the same control and panel SHALL render at the message's width with a touch-sized control.

#### Scenario: The panel sits under the chip row

- **WHEN** the human expands a chip
- **THEN** its feed renders directly beneath the chip row, within the same message block, at the
  message's width

#### Scenario: A long feed scrolls inside the panel

- **WHEN** an expanded ticket's feed is longer than the panel's cap
- **THEN** the panel grows no taller than about ten lines and the extra content scrolls inside it,
  leaving the chat's scroll position unaffected

#### Scenario: A short feed is content height

- **WHEN** an expanded ticket's feed holds a single line
- **THEN** the panel is that content's height rather than a tall empty box

#### Scenario: Scrolling up inside the panel pauses its follow

- **WHEN** the human scrolls up inside an expanded panel while new content arrives
- **THEN** the panel stays where they put it and the chat behind it does not move

#### Scenario: A new line does not move the chat

- **WHEN** new output arrives in an expanded panel while the reader is scrolled up in the chat
- **THEN** the chat's scroll position is unchanged and no layout jump occurs

#### Scenario: Reduced motion skips the closing transition

- **WHEN** reduced motion is set and an expanded panel auto-collapses
- **THEN** the panel is removed without the transition, the feed unmounting immediately

#### Scenario: Phone keeps the same control and panel

- **WHEN** the chat is shown at phone width
- **THEN** each chip carries the same expand control with a touch-sized hit target, and the panel
  opens at the message's width

#### Scenario: The global chats show the panel, the planner chat does not

- **WHEN** a workspace is shown as a pane of the global chats, and a plan tab's planner chat is shown
- **THEN** a chip in the pane expands to its inline panel and the planner chat renders none