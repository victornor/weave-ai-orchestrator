# web-v2/chat-composer — delta

## MODIFIED Requirements

### Requirement: The dictation meter never drives its own layout size

The listening waveform drawn by the composer's dictation meter SHALL NOT determine the size of any
element in the page. The element that allocates the meter's space SHALL be sized by the surrounding
layout and by CSS alone; the canvas's backing-store dimensions SHALL be derived from that box and
SHALL NOT feed back into it. In particular, growing the canvas's `width` or `height` attribute SHALL
NOT change the element's laid-out width or height. This SHALL hold in every host of the composer,
including the weaver chat and a plan tab.

#### Scenario: The meter holds its width across frames

- **WHEN** dictation is listening on a display with `devicePixelRatio` of 2 and the meter redraws
  across many frames
- **THEN** the meter's laid-out width is the same after several seconds as it was on the first frame

#### Scenario: The meter holds its width in any host

- **WHEN** the meter is rendered in a host that does not itself clamp the composer's width and the
  backing store is resized every frame
- **THEN** the meter and its ancestors do not widen, on any browser engine

#### Scenario: A wide meter does not widen the composer

- **WHEN** the listening waveform appears in a plan tab's composer
- **THEN** the tab's conversation pane width is unchanged from before dictation started
