## ADDED Requirements

### Requirement: A live cell can be resized by dragging and the grid reflows

On a viewport wide enough for more than one column, each Live cell SHALL offer a drag handle (an
edge or corner) that makes that cell larger or smaller. The grid SHALL reflow around the new size so
every remaining cell stays on screen and usable: growing one cell SHALL NOT overlay its neighbours
and SHALL NOT leave an unusable hole the human cannot recover from.

A cell that has never been resized SHALL occupy the same equal slot the Live page already uses. A
handle that is pressed and released without moving SHALL change nothing. Resetting a cell (the
handle's reset action) SHALL return it to that equal slot.

The chosen size SHALL last for the rest of the tab session, including a reload of the Live page in
the same tab. It SHALL NOT be required to survive closing the tab, switching devices, or a worker
that has left the live set. A browser that refuses storage SHALL still resize for the session.

Empty, loading and error states SHALL NOT grow a resize handle.

The cell SHALL remain a link, not a control surface: resizing SHALL NOT steer, attach, pause,
resume, cancel or hide the worker.

#### Scenario: Dragging a handle makes that cell larger

- **WHEN** two or more live workers have cells on a multi-column Live page and the human drags one
  cell's handle to make it larger
- **THEN** that cell occupies more of the grid than an unresized neighbour, and the neighbours
  reflow around it rather than being covered

#### Scenario: Dragging a handle makes that cell smaller

- **WHEN** a cell has been made larger than the equal slot and the human drags its handle to shrink it
- **THEN** that cell occupies less of the grid, down to no smaller than the equal slot, and the
  neighbours reflow into the space it freed

#### Scenario: A press without a move changes nothing

- **WHEN** the human presses a cell's resize handle and releases it without moving
- **THEN** that cell stays the size it was

#### Scenario: Reset returns the equal slot

- **WHEN** a cell has been resized and the human resets it
- **THEN** that cell occupies the equal slot again

#### Scenario: The size survives a reload in the same tab

- **WHEN** the human has resized a still-live worker's cell and reloads the Live page in the same tab
- **THEN** that worker's cell opens at the size they chose

#### Scenario: Empty and loading have no handle

- **WHEN** the Live page is showing its loading state or its empty state
- **THEN** no resize handle is present

### Requirement: At phone width a cell expands by tap, not by dragging

On a one-column viewport, a Live cell SHALL NOT offer a drag-resize handle. Dragging at that width
fights page scrolling. Each cell SHALL instead offer a control that expands that cell (a larger
share of the transcript) and that restores it when activated again.

Expanding one cell SHALL NOT hide the others and SHALL NOT change who is in the live set. Empty,
loading and error states SHALL NOT grow the expand control.

#### Scenario: Phone has expand, not drag

- **WHEN** the Live page is shown at phone width with at least one live cell
- **THEN** each cell has an expand control and no drag-resize handle

#### Scenario: Tapping expand enlarges that cell

- **WHEN** the human activates a cell's expand control at phone width
- **THEN** that cell's transcript occupies a larger share of the page than an unexpanded neighbour,
  and the other cells remain visible

#### Scenario: Tapping again restores the cell

- **WHEN** an expanded cell's expand control is activated again
- **THEN** that cell returns to the unexpanded size
