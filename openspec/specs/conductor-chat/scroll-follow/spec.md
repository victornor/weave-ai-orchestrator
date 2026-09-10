# conductor-chat/scroll-follow Specification

## Purpose
Defines the conductor chat message list's follow-the-bottom behavior — when it scrolls, when it must
not, what "at the bottom" actually means, and an opt-in way to capture that state on a device where
the behavior is suspected wrong but cannot be reproduced elsewhere.

## Requirements

### Requirement: The list ends at its true bottom, not merely at a scroll call

When the message list follows new content, it SHALL end scrolled so that its newest content is
visible — within the at-bottom threshold of `scrollHeight - clientHeight` — even when the content
that triggered the follow, or the container itself, changes height after the scroll was issued. A
scroll that was issued but left the list short of its true bottom SHALL be corrected without waiting
for another message to arrive.

#### Scenario: Content grows after the scroll fires

- **WHEN** a new message is followed to the bottom, and the message's own rendered height then grows
  (an image finishing its load, a code block finishing highlighting, a markdown table reflowing)
- **THEN** the list ends at the new, true bottom, not at the shorter position the initial scroll
  targeted

#### Scenario: Several messages arrive faster than one scroll can finish

- **WHEN** several messages are followed to the bottom in quick succession, faster than a smooth
  scroll to any one of them would complete
- **THEN** the list ends at the true bottom of the last message once they stop arriving

### Requirement: Deliberate scrolling up is never overridden

A message list the human has scrolled away from the bottom SHALL NOT be moved by new content
arriving, by the content's height changing, or by the container's own geometry changing. It SHALL
offer a way back to the bottom, and SHALL indicate when content arrived while they were away.

#### Scenario: Scrolled up while a turn streams

- **WHEN** the human has scrolled away from the bottom and the conductor's reply keeps streaming in
- **THEN** the viewport stays exactly where they left it, and a way back to the bottom is offered

#### Scenario: Returning to the bottom

- **WHEN** the human scrolls back to the bottom themselves, or uses the way back to it
- **THEN** the list resumes following new content as it arrives

### Requirement: The follow state can be captured on demand

The chat SHALL be able to record a bounded history of its own follow-and-scroll measurements —
scroll position, container and content geometry, the at-bottom test's result, and whether it was
following at the time — for later inspection, without recording anything unless this is explicitly
turned on. Recording SHALL add no observable cost when it is off.

#### Scenario: Diagnostics off by default

- **WHEN** the chat is used without diagnostics explicitly enabled
- **THEN** no follow-state history is recorded

#### Scenario: Capturing a failure

- **WHEN** diagnostics are enabled and the list fails to reach its true bottom on a new message
- **THEN** the recorded history for that moment can be retrieved and shows the scroll and geometry
  measurements leading up to it, including what changed height and when
