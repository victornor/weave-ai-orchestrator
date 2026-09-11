## ADDED Requirements

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
