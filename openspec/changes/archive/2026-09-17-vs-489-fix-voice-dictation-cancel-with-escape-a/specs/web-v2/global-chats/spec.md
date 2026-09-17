## ADDED Requirements

### Requirement: Dictation belongs to the focused pane

In the all-weaver-chats view, voice dictation SHALL be routed through exactly one pane — the focused
pane. Starting dictation from that view SHALL set the session's target to the focused pane's
composer, so the transcript is inserted there and the recording UI is the same in-composer dictation
UI the single-chat page uses. Only the focused pane SHALL offer an active dictate control or display
a recording indicator, and the off-page dictation bar SHALL NOT be shown while the session's target
composer is the focused, on-screen composer. At most one pane SHALL be in the recording state at any
time: starting a second recording SHALL be refused while any session is active, so a pane that does
not own the session offers no way to start one, and no pane SHALL show a recording indicator other
than the one owning the session.

#### Scenario: Dictating in the multi-chat view lands in the focused pane

- **WHEN** the view shows several panes, the human focuses one pane and starts dictation
- **THEN** that pane's composer shows the in-composer recording UI, the recognized text is inserted
  into that pane's composer, and the off-page dictation bar is not shown

#### Scenario: Only the focused pane records

- **WHEN** a dictation is active in the focused pane
- **THEN** no other pane shows a recording indicator and no other pane can start a second dictation

#### Scenario: Starting dictation in a second pane is refused

- **WHEN** a dictation is active for one pane and the human focuses another pane
- **THEN** the newly focused pane's dictate control is inert and no second recording starts, so only
  the pane that owns the session is recording; stopping it (bar, chord or Escape) and starting again
  in the other pane is how the session moves

#### Scenario: The off-page bar does not open from the multi-chat view

- **WHEN** dictation is started in the focused pane of the multi-chat view and that pane stays focused
- **THEN** the off-page dictation bar stays absent for the whole session
