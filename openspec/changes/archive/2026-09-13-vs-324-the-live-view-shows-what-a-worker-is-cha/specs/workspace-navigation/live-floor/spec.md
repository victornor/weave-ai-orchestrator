## MODIFIED Requirements

### Requirement: A live cell can be resized by dragging and the grid reflows

On a viewport wide enough for more than one column, each Live cell SHALL offer a drag handle (an
edge or corner) that makes that cell larger or smaller. The grid SHALL reflow around the new size so
every remaining cell stays on screen and usable: growing one cell SHALL NOT overlay its neighbours
and SHALL NOT leave an unusable hole the human cannot recover from.

The size space SHALL be fine enough that dragging reads as continuous resizing rather than snapping
between a handful of discrete sizes. At desktop (`xl`) width the grid SHALL offer at least twelve
distinct widths; at the intermediate (`sm`) breakpoint it SHALL offer at least eight. Height SHALL
offer at least eight distinct sizes, not two.

A cell that has never been resized SHALL occupy half the grid's width at the `sm` and `xl`
breakpoints, and the full grid's width on a one-column viewport — its equal slot — whatever the
chosen width and height granularity. A handle that is pressed and released without moving SHALL
change nothing. Resetting a cell (the handle's reset action) SHALL return it to that equal slot.

The chosen size SHALL last for the rest of the tab session, including a reload of the Live page in
the same tab. It SHALL NOT be required to survive closing the tab, switching devices, or a worker
that has left the live set. A browser that refuses storage SHALL still resize for the session. A
size saved before the equal slot's width changed SHALL keep resizing and persisting exactly as it
did before, since only the never-resized default is affected.

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

#### Scenario: Width steps read as continuous at desktop width

- **WHEN** the Live page is shown at desktop (`xl`) width and the human drags a cell's handle
  across the full width available to it
- **THEN** the cell can land on at least twelve distinct widths on the way, not three

#### Scenario: Height has a comparable range to width

- **WHEN** the human drags a cell's handle across the full height available to it
- **THEN** the cell can land on at least eight distinct heights on the way, not two

#### Scenario: A press without a move changes nothing

- **WHEN** the human presses a cell's resize handle and releases it without moving
- **THEN** that cell stays the size it was

#### Scenario: A never-resized cell is half the grid at desktop width

- **WHEN** the Live page is shown at desktop (`xl`) width and a live worker's cell has never been
  resized
- **THEN** that cell occupies half the grid's width, so two cells read per row

#### Scenario: A never-resized cell is half the grid at the intermediate breakpoint

- **WHEN** the Live page is shown at the intermediate (`sm`) breakpoint and a live worker's cell has
  never been resized
- **THEN** that cell occupies half the grid's width, so two cells read per row

#### Scenario: A never-resized cell is the full width on a phone

- **WHEN** the Live page is shown at a one-column (phone) viewport and a live worker's cell has
  never been resized
- **THEN** that cell occupies the full grid's width, so one cell reads per row

#### Scenario: Reset returns the equal slot

- **WHEN** a cell has been resized and the human resets it
- **THEN** that cell occupies the equal slot again, at whatever width the current breakpoint gives it

#### Scenario: The size survives a reload in the same tab

- **WHEN** the human has resized a still-live worker's cell and reloads the Live page in the same tab
- **THEN** that worker's cell opens at the size they chose

#### Scenario: A size saved under the previous equal slot keeps working

- **WHEN** a live worker's cell was explicitly resized and saved before the equal slot's width
  changed at `xl`
- **THEN** that saved size still opens and resizes exactly as it did before, unaffected by the new
  equal slot

#### Scenario: Empty and loading have no handle

- **WHEN** the Live page is showing its loading state or its empty state
- **THEN** no resize handle is present
