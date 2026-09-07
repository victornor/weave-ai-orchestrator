# conductor-chat/composer-send-key Specification

## Purpose
Defines what pressing Enter does in a message composer, so that a keyboard with a modifier key can send with one keystroke while a keyboard without one can still write more than a single line.

## Requirements

### Requirement: Enter sends where a modifier is available, and breaks the line where it is not

A composer SHALL decide what the Enter key does from the kind of pointing device the browser reports, not from the identity of the browser or the operating system.

Where the device has a hovering pointer — a desk with a physical keyboard — pressing Enter SHALL send the message and SHALL NOT insert a line break, and pressing Enter with Shift held SHALL insert a line break and SHALL NOT send.

Where the device has no hovering pointer — a phone or a tablet driven by touch — pressing Enter SHALL insert a line break and SHALL NOT send, whether or not Shift is held. On such a device the send control SHALL be the only way to send, and it is already present in every composer.

The decision SHALL be made when the composer is presented, and the composer is NOT required to follow a device that changes kind while it is on screen.

This SHALL hold for every composer the app presents: the conductor chat, the reply to a ticket, and the message to a worker.

#### Scenario: Sending from a desk

- **WHEN** the human types a message into a composer on a device with a hovering pointer and presses Enter
- **THEN** the message is sent, and no line break is left in the composer

#### Scenario: A second paragraph at a desk

- **WHEN** the human presses Enter with Shift held on a device with a hovering pointer
- **THEN** a line break is inserted and nothing is sent

#### Scenario: A second paragraph on a phone

- **WHEN** the human types a message on a device with no hovering pointer and presses Enter on the on-screen keyboard
- **THEN** a line break is inserted and nothing is sent

#### Scenario: Sending from a phone

- **WHEN** the human has written a message on a device with no hovering pointer and activates the send control
- **THEN** the message is sent, exactly as it is on any other device

### Requirement: The on-screen keyboard labels its Enter key for what it does

Where the composer treats Enter as a line break, it SHALL ask the on-screen keyboard to present that key as a newline key rather than as a send or go key, so the label does not promise an action the composer will not take.

Where the composer treats Enter as send, it SHALL leave the key's presentation to the browser's default.

No text shown beside or inside a composer SHALL tell the human that Enter sends on a device where it does not.

#### Scenario: The keyboard's own label on touch

- **WHEN** a composer is presented on a device with no hovering pointer
- **THEN** the input asks the on-screen keyboard for a newline key

#### Scenario: No hint left on desktop

- **WHEN** a composer is presented on a device with a hovering pointer
- **THEN** the input makes no such request, and the browser's default key is shown
