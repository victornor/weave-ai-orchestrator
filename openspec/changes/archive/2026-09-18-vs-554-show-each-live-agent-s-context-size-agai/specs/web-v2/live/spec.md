## ADDED Requirements

### Requirement: A Live card states context size against the model window

Every V2 Live card SHALL state the worker's context size for its last completed turn and, where the
model's context window is known, how full that is, including a visible mark at the runtime's
compaction point. The size SHALL be the value recorded on the worker's active session from the
turn's reported usage — the same figure the automatic compaction policy reads — and the card SHALL
label the figure as the last completed turn rather than a live count. The proportion SHALL be
derived from the shared `contextStrip` view-model, so a Live card and the weaver chat or run page
cannot report different figures for the same turn. A worker with no completed turn SHALL show no
context line rather than a zeroed one.

#### Scenario: A known window shows size and fullness

- **WHEN** a live worker's active session records a context size and its model's context window is known
- **THEN** its card shows the recorded size, the window, and how full the window is, labelled as the last completed turn

#### Scenario: The compaction point is visible

- **WHEN** the worker's runtime reports a compaction point for the model's window
- **THEN** the card marks that point on the meter, not only the raw fraction

#### Scenario: The figure agrees with the other surfaces

- **WHEN** the same turn's context size is shown in the weaver chat or on the run page
- **THEN** the Live card shows the same figure for that turn, both derived from the shared context view-model

#### Scenario: A worker with no completed turn

- **WHEN** a live worker has not completed a turn on its active session
- **THEN** its card shows no context line and no zeroed meter

### Requirement: An unknown context window shows the count without a fabricated proportion

When the runtime cannot state the model's context window, the Live card SHALL show the recorded
context size and state that the window is unknown, and SHALL NOT draw a proportion or invent a
window.

#### Scenario: A runtime with no stated window

- **WHEN** a live worker runs on a runtime that cannot state its model's context window
- **THEN** its card shows the context size and says the window is unknown, with no proportion drawn

### Requirement: The Live context line holds at phone width

The context line SHALL stay within its card at phone width without wrapping the card's header or
ticket line, and SHALL NOT change the grid's column count, the feed heights or the toolbar.

#### Scenario: Phone width

- **WHEN** the Live floor renders at phone width
- **THEN** each card shows its context line on one line and the grid, feed heights and toolbar are unchanged
