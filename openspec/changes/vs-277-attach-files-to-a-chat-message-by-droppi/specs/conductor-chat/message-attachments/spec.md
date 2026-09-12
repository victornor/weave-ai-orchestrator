## MODIFIED Requirements

### Requirement: An attachment can be added by browsing or by pasting

The conductor chat composer SHALL offer a browse control that opens a file picker, SHALL accept a
file pasted from the clipboard directly into the composer, and SHALL accept one or more files dropped
onto the composer. All three paths SHALL produce the same attached state on the message before it is
sent: the same acceptance rules, the same per-message limit, and the same feedback when a file is
rejected. A drop SHALL be treated as an attachment drag only when the dragged data includes files;
any other drag SHALL be left to the browser as it is today. A file dropped anywhere in the app SHALL
never cause the browser to navigate away from the app or unload it, whether or not it lands on the
composer. Where attachments are not allowed, a drop SHALL attach nothing and SHALL show no drop
indication.

#### Scenario: Attaching by browse

- **WHEN** a human uses the browse control and selects an accepted-type file
- **THEN** the file appears attached to the composer, pending send

#### Scenario: Attaching by paste

- **WHEN** a human pastes an image from the clipboard into the composer
- **THEN** the image appears attached to the composer, pending send, without the human choosing a file
  through the browse control

#### Scenario: Attaching by dropping

- **WHEN** a human drags one or more accepted-type files over the composer and releases them there
- **THEN** the files appear attached to the composer, pending send, in exactly the state pasting the
  same files produces

#### Scenario: Dropping a disallowed file alongside accepted ones

- **WHEN** a file whose type is not accepted is dropped onto the composer, alone or mixed with
  accepted files
- **THEN** the accepted files are attached, the disallowed file is not, and the same feedback pasting
  the same files would produce is shown

#### Scenario: Dropping more files than the limit

- **WHEN** more files than the per-message limit are dropped onto the composer
- **THEN** files up to the limit are attached and the same limit message pasting them would produce is
  shown

#### Scenario: Dropping a file outside the composer

- **WHEN** a file is dropped anywhere in the app other than the composer's drop target
- **THEN** nothing is attached, the composer's text is unchanged, and the browser is still prevented
  from navigating away to the dropped file

#### Scenario: Dragging non-file content over the composer

- **WHEN** selected text or a link is dragged over the composer
- **THEN** no attachment state or drop indication appears, and the drag behaves exactly as it did
  before this capability existed

#### Scenario: Dropping where attachments are not allowed

- **WHEN** a file is dropped onto a composer whose attachments are not allowed
- **THEN** nothing is attached and no drop indication is shown
