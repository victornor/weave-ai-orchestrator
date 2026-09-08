# conductor-chat/message-attachments Specification

## Purpose
Lets a human attach a file or an image to a message in the conductor chat, by browsing or by pasting,
stores it safely, and delivers its actual content — not just a filename — to the conductor, within
explicit server-enforced limits.

## Requirements

### Requirement: A message can carry up to four attachments, sent with the text in one request

A human message to a conductor chat thread that is not bound to a ticket SHALL be able to carry between
zero and four file attachments, submitted together with the message text in a single request. A message
sent with no attachments SHALL be accepted and SHALL behave exactly as a message sent before this
capability existed.

#### Scenario: Message sent with one image attachment

- **WHEN** a human sends a message with one accepted-type image attached, under the size cap
- **THEN** the message is accepted, is stored with a reference to the attachment, and the thread's
  `last_message_at` is updated exactly as for a text-only message

#### Scenario: Message sent with no attachment

- **WHEN** a human sends a message with no attachment
- **THEN** the message is accepted and behaves identically to a message sent before this capability
  existed

#### Scenario: More than four files attached

- **WHEN** a human's request carries more than four files
- **THEN** the request is rejected before any file is stored, and the response states the four-file
  limit

### Requirement: An attachment can be added by browsing or by pasting

The conductor chat composer SHALL offer a browse control that opens a file picker, and SHALL accept a
file pasted from the clipboard directly into the composer. Both paths SHALL produce the same attached
state on the message before it is sent.

#### Scenario: Attaching by browse

- **WHEN** a human uses the browse control and selects an accepted-type file
- **THEN** the file appears attached to the composer, pending send

#### Scenario: Attaching by paste

- **WHEN** a human pastes an image from the clipboard into the composer
- **THEN** the image appears attached to the composer, pending send, without the human choosing a file
  through the browse control

### Requirement: Only an explicit, narrow set of file types and sizes is accepted

The server SHALL accept only: images (`image/png`, `image/jpeg`, `image/gif`, `image/webp`) up to 5MB
each, and plain text (`text/plain`, `text/markdown`) up to 256KB each. Any other declared type, or a
file exceeding its type's cap, SHALL be rejected before it is stored, with a response stating why.
An image's declared type SHALL be verified against the file's own leading bytes before it is trusted;
a mismatch SHALL be rejected as if the declared type were wrong.

#### Scenario: Disallowed type rejected

- **WHEN** a human attaches a file whose type is not in the accepted set (for example a PDF or a
  spreadsheet)
- **THEN** the request is rejected before storage, and the response names the file and states that its
  type is not accepted

#### Scenario: Oversized file rejected

- **WHEN** a human attaches an image larger than 5MB, or a text file larger than 256KB
- **THEN** the request is rejected before the file is fully stored, and the response states the
  relevant cap

#### Scenario: Mislabelled file rejected

- **WHEN** a human attaches a file declared as an accepted image type but whose contents do not match
  that type's signature
- **THEN** the request is rejected as an unsupported type

#### Scenario: Request too large to be worth transferring

- **WHEN** a request's declared size already exceeds what any combination of accepted files and caps
  could satisfy
- **THEN** the request is rejected before its body is read in full

### Requirement: The conductor receives an image attachment's actual visual content

When the conductor's next turn reads why it was woken, an image attachment on the message that woke it
SHALL be delivered as real image content the model can see, not as a filename or a reference the
conductor must separately fetch.

#### Scenario: Conductor reads an image attachment

- **WHEN** the conductor calls its inbox tool for a wake caused by a message with an image attachment
- **THEN** the tool result includes the image's actual bytes, in a form the model renders visually,
  alongside the message's text

### Requirement: The conductor receives a text-document attachment's actual content

A plain-text attachment (`text/plain` or `text/markdown`) SHALL be delivered to the conductor as its
literal text content, inline in the same tool result that reports the message.

#### Scenario: Conductor reads a text-document attachment

- **WHEN** the conductor calls its inbox tool for a wake caused by a message with a `text/plain` or
  `text/markdown` attachment
- **THEN** the tool result includes that file's full text content, not just its name

### Requirement: An attachment is visible on the message in the transcript, including after a reload

A sent message carrying an attachment SHALL show the attachment in the transcript immediately after
sending, and SHALL show it identically after the page or client reloads and re-fetches the thread's
messages.

#### Scenario: Attachment visible immediately after send

- **WHEN** a human sends a message with an image attachment
- **THEN** the attachment is shown on that message in the transcript without a reload

#### Scenario: Attachment visible after reload

- **WHEN** a client reloads and re-fetches a thread that has a message with an attachment
- **THEN** the attachment is shown on that message exactly as it was before the reload

### Requirement: Attachment storage and serving is safe by construction

An attachment SHALL be stored outside any directory served as static content. It SHALL be retrievable
only through an authenticated route scoped to the thread it was sent in, and SHALL never be served with
a content type asserted by the uploading client for execution purposes, nor with the client's own
filename used to construct a filesystem path.

#### Scenario: Attachment not reachable as static content

- **WHEN** a request is made for an attachment's storage location directly, bypassing the serving route
- **THEN** no static file server responds to it; nothing outside the serving route can reach the bytes

#### Scenario: Attachment fetch requires authentication

- **WHEN** an unauthenticated request is made to the attachment serving route
- **THEN** the request is refused exactly as any other unauthenticated request to this daemon's API is

#### Scenario: A crafted filename cannot escape storage

- **WHEN** an attachment is uploaded with a filename containing path-traversal characters (for example
  `../../etc/passwd`)
- **THEN** the file is stored under a server-generated name, and the crafted filename affects only the
  display name, never the storage path

### Requirement: An attachment cannot be fetched from a different thread or workspace

An attachment SHALL be reachable only through the thread it was sent in. A request naming the correct
attachment id but the wrong thread id, or made against a different workspace, SHALL be refused.

#### Scenario: Cross-thread fetch refused

- **WHEN** a request for an attachment names a thread id other than the thread the attachment was sent
  in
- **THEN** the request is refused as not found

#### Scenario: Cross-workspace fetch refused

- **WHEN** a request for an attachment is made against a different workspace than the one the
  attachment belongs to
- **THEN** the attachment does not exist from that workspace's point of view, and the request is
  refused as not found

### Requirement: Attachments on a ticket-bound thread are refused

A message sent to a conductor chat thread that is bound to a ticket SHALL NOT accept attachments; a
request carrying one SHALL be rejected before any file is stored, leaving the existing ticket-comment
behavior for the message text unaffected.

#### Scenario: Attachment attempted on a ticket-bound thread

- **WHEN** a human sends a message with an attachment to a thread that is bound to a ticket
- **THEN** the request is rejected before storage, and the response states that attachments are not
  supported on a ticket-bound thread

### Requirement: A failed attachment upload leaves the composer's text intact

When a message with an attachment fails to send — whether because of a rejected file or a transport
failure — the composer SHALL retain the typed text and the pending attachment, and SHALL state what
went wrong, rather than clearing the message.

#### Scenario: Rejected attachment leaves the message editable

- **WHEN** a human attempts to send a message with a disallowed or oversized attachment
- **THEN** the send fails, the composer's text and the attempted attachment remain present, and a
  reason for the failure is shown

#### Scenario: Transport failure leaves the message editable

- **WHEN** a message with an attachment fails to send because of a network or server error
- **THEN** the composer's text and the attempted attachment remain present, and the failure is shown

### Requirement: An attachment persists for the life of the message that carries it

An attachment SHALL be retained for as long as the message it was sent with exists, is not counted
toward any usage or budget accounting, and has no separate expiry. Any future capability that deletes a
message SHALL delete that message's attachments in the same operation.

#### Scenario: Attachment remains reachable indefinitely

- **WHEN** time passes with no action taken on a message carrying an attachment
- **THEN** the attachment remains stored and reachable through its serving route, with no automatic
  expiry
