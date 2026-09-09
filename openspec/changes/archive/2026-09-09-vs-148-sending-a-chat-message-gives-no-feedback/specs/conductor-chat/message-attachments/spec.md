## REMOVED Requirements

### Requirement: A failed attachment upload leaves the composer's text intact

**Reason**: Generalized beyond attachments — a failed plain-text send used to clear the composer too,
which was never specified. Superseded by `conductor-chat/composer-send-lifecycle`'s "A message is not
lost when its send fails", which covers every send, with or without an attachment.

**Migration**: No behavior is lost; see `conductor-chat/composer-send-lifecycle` for the requirement
that now covers this.

#### Scenario: Rejected attachment leaves the message editable

- **WHEN** a human attempts to send a message with a disallowed or oversized attachment
- **THEN** the send fails, the composer's text and the attempted attachment remain present, and a
  reason for the failure is shown

#### Scenario: Transport failure leaves the message editable

- **WHEN** a message with an attachment fails to send because of a network or server error
- **THEN** the composer's text and the attempted attachment remain present, and the failure is shown
