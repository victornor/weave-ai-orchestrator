# conductor-chat/composer-send-lifecycle Specification

## Purpose
Governs what a composer does between the moment a human triggers a send and the moment the daemon has
durably accepted or rejected it: locking the send control, showing that something is happening,
retaining what was typed on failure, and stopping a retried send from being accepted twice.

## Requirements

### Requirement: The send control is unavailable while a send is in flight

From the moment a send is triggered — by the send control or by the Enter key — until the request it
started has settled, the composer SHALL NOT accept another attempt to send the same composer's
contents: the send control SHALL be disabled, and Enter SHALL NOT trigger another send. Once the
request settles, the composer SHALL return to accepting a send exactly as before.

This SHALL hold whether the send carries an attachment or not, and whether it succeeds or fails.

#### Scenario: A second tap while the first send is still in flight

- **WHEN** a human sends a message and taps the send control again before the first request has
  settled
- **THEN** the second tap has no effect, and only the original request is ever made

#### Scenario: Enter pressed again mid-flight

- **WHEN** a human sends a message with Enter, on a device where Enter sends, and presses Enter again
  before the request has settled
- **THEN** the second press has no effect

#### Scenario: The control is available again once the send settles

- **WHEN** a send request finishes, whether it succeeded or failed
- **THEN** the send control accepts a new send attempt again

### Requirement: Visible progress is shown while a send is in flight

While a send is in flight, the composer SHALL show that something is happening, rather than looking
idle. Where the send carries a file, the composer SHALL word this to reflect that the upload and the
send are not observably distinct steps over the transport in use, rather than implying a step has
completed that has not.

#### Scenario: Sending a plain-text message

- **WHEN** a human sends a message with no attachment
- **THEN** the composer shows that the message is being sent for as long as the request is in flight

#### Scenario: Sending a message with an attachment on a slow connection

- **WHEN** a human sends a message with an attachment and the request takes several seconds
- **THEN** the composer shows that the message is being sent throughout the wait, worded to cover the
  upload and the send together

### Requirement: A message is not lost when its send fails

The composer SHALL clear its text and any attachments only once a send has been confirmed to have
succeeded. When a send fails, the composer SHALL retain the text and attachments exactly as the human
left them, along with whatever the message was scoped to (a reply reference, a chosen project), and
SHALL show that the send failed, so the same attempt can be retried without retyping anything.

This SHALL hold for a plain-text message exactly as it already holds for one with an attachment.

#### Scenario: A plain-text send fails

- **WHEN** a human sends a message with no attachment and the send fails
- **THEN** the composer keeps the typed text, shows that the send failed, and lets the human retry

#### Scenario: A send with a reply reference fails

- **WHEN** a human sends a message that is scoped to a reply reference or a chosen project, and the
  send fails
- **THEN** the reply reference and the chosen project are still shown on the composer after the failure

#### Scenario: A retried send succeeds

- **WHEN** a human retries a message that previously failed to send, without changing it, and the retry
  succeeds
- **THEN** the composer clears its text, attachments, reply reference and project pick exactly as a
  first-attempt success would

### Requirement: A retried send is not accepted twice by the daemon

A client sending a message to a conductor chat thread MAY include a client-generated idempotency key
with the request. Where a key is present, the server SHALL treat a request carrying a key already
recorded for that thread as the same message: it SHALL return the message already stored under that
key rather than creating another one, and SHALL NOT wake the conductor a second time for it. A request
with no key, or a key not seen before on that thread, SHALL be accepted exactly as it is today.

This SHALL hold whether the repeated request arrives because a client retried after a lost response, or
for any other reason a client resends the same key.

#### Scenario: A retry after a lost response is not duplicated

- **WHEN** a client's request is accepted and stored by the server, the response is then lost before
  the client sees it, and the client retries with the same idempotency key
- **THEN** the server returns the message it already stored, no second message is created, and the
  conductor is not woken a second time

#### Scenario: A new message with no key behaves as before

- **WHEN** a client sends a message with no idempotency key
- **THEN** the message is accepted and stored exactly as it was before this capability existed

#### Scenario: A genuinely new message is not mistaken for a retry

- **WHEN** a human edits a message after a previous attempt failed, and sends the edited text with a
  new idempotency key
- **THEN** the edited message is stored as its own message, distinct from the earlier attempt

### Requirement: A send settles in bounded time

A send that has been triggered SHALL settle — success, failure, or timeout treated as a failure the existing failure path already handles — within a short bound, rather than remaining in flight until the document is reloaded. The bound SHALL apply when the daemon is reachable but the response does not arrive, including when other connections to the same origin are occupied.

Once the request settles, the send control SHALL accept a new attempt exactly as `The send control is unavailable while a send is in flight` already requires.

A timeout SHALL NOT be treated as a successful send: the composer SHALL keep the text as `A message is not lost when its send fails` already requires. If the daemon did accept the message and the client retries with the same idempotency key, `A retried send is not accepted twice by the daemon` still holds.

#### Scenario: The daemon accepted the message and the client saw 201

- **WHEN** a human sends a plain-text message and the send request completes successfully
- **THEN** the composer leaves the in-flight send label, clears on the same terms as today, and does not wait for a live stream event

#### Scenario: The send request never returns

- **WHEN** a human sends a plain-text message and the send request does not complete within the bound
- **THEN** the composer leaves the in-flight send label, keeps the typed text, and shows that the send failed or queued, without requiring a reload
