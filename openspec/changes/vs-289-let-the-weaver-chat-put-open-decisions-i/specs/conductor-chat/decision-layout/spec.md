## ADDED Requirements

### Requirement: The open-decision area has a device-local layout choice

The conductor chat SHALL choose where its open decisions render between `bottom` — pinned between
the transcript and the composer, which is today's behavior and the default — and `split` — a column
to the right of the transcript and composer. The choice SHALL be stored on the device, SHALL default
to `bottom` when nothing is stored, and SHALL survive a reload. It SHALL be a view preference of this
device, not workspace or account state. When the device refuses storage, the choice SHALL still hold
for the session.

#### Scenario: The default is the bottom strip

- **WHEN** the chat renders on a device that has never chosen a layout
- **THEN** open decisions render in the bottom strip, exactly as before this change

#### Scenario: A chosen split layout survives a reload

- **WHEN** the human chooses the split layout and reloads the page
- **THEN** the chat renders in the split layout again

#### Scenario: Storage is refused

- **WHEN** the device refuses `localStorage` and the human chooses a layout
- **THEN** the chosen layout is used for the rest of the session, and nothing throws

### Requirement: The layout control is on the chat screen and offers only what the viewport can honour

The chat screen SHALL carry the control that switches the layout, discoverable on the screen itself
rather than in Settings. On a viewport narrower than the app's `md` breakpoint the layout SHALL be
`bottom` regardless of what is stored, and the control SHALL NOT offer `split`.

#### Scenario: The control switches layouts on a desktop viewport

- **WHEN** a user activates the `split` option of the control on a wide viewport
- **THEN** the open decisions move from the bottom strip to the right-hand rail, and activating the
  `bottom` option moves them back

#### Scenario: A narrow viewport falls back to the bottom layout

- **WHEN** the chat renders on a viewport narrower than `md` with `split` stored
- **THEN** the open decisions render in the bottom strip, and no rail is rendered

#### Scenario: A narrow viewport does not offer split

- **WHEN** the chat renders on a viewport narrower than `md`
- **THEN** the layout control does not present a `split` option that the viewport cannot honour

### Requirement: In the split layout the decisions rail sits beside the conversation

Where the split layout is honoured, the open decision cards SHALL render in a column to the right of
the transcript and the composer, and the bottom strip SHALL NOT also render. The transcript and the
composer SHALL keep the left pane, and the composer SHALL keep enough width for its own controls.
Answered decisions SHALL continue to render inline in the transcript in both layouts.

#### Scenario: Split moves the open cards into the rail

- **WHEN** the split layout is active and at least one decision is open
- **THEN** the open cards render in the right-hand rail and no pinned strip renders between the
  transcript and the composer

#### Scenario: Answered decisions stay in the transcript

- **WHEN** a decision is answered in either layout
- **THEN** its card remains in the conversation at the point it was raised, and leaves the rail or
  strip

#### Scenario: The composer keeps the left pane

- **WHEN** the split layout is active
- **THEN** the composer, including its attachment chips and dictation control, renders in the left
  pane and remains usable

### Requirement: The two panes scroll independently

The conversation pane and the decisions rail SHALL each own their vertical scrolling, so scrolling
one SHALL NOT move the other and a page whose panes both fit SHALL NOT scroll as a whole.

#### Scenario: A long conversation does not move the rail

- **WHEN** the conversation is taller than its pane and the human scrolls it
- **THEN** the rail stays where it is

#### Scenario: A long decisions list does not move the conversation

- **WHEN** the rail holds more open cards than fit and the human scrolls it
- **THEN** the conversation stays where it is

### Requirement: The hidden-from-chat count works in both layouts

The affordance that reports how many open decisions are hidden from the chat and restores them SHALL
render in whichever region holds the open cards, in both layouts.

#### Scenario: Hidden decisions in the split layout

- **WHEN** the split layout is active and one or more open decisions are hidden on this device
- **THEN** the rail shows the hidden count and activating it restores those cards into the rail

### Requirement: An empty decision area leaves no dead column

When there are no open decisions and none hidden, the split layout SHALL NOT render a rail; the
conversation SHALL use the full width it has in the bottom layout and no empty column SHALL take a
share of the screen.

#### Scenario: Nothing needs the human

- **WHEN** the split layout is active and no decisions are open or hidden
- **THEN** no decisions rail renders and the conversation fills the frame

### Requirement: The bottom layout's resizable pinned area is preserved

The bottom layout SHALL keep its drag-to-resize pinned area and the reset affordance. The rail of the
split layout SHALL be full-height and SHALL NOT render that resize handle.

#### Scenario: The resize handle belongs to the bottom layout

- **WHEN** the human switches from the bottom layout to the split layout
- **THEN** the pinned area's resize handle disappears with the strip, and switching back restores it
