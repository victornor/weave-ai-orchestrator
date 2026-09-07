## MODIFIED Requirements

### Requirement: A reload mid-turn resumes the live view

When a chat surface loads while a conductor turn is already running, it SHALL show that turn's activity so far and continue receiving the rest of it, rather than showing an empty live region. When the connection to the live stream drops and is re-established, the surface SHALL resume from where it stopped without re-rendering activity it already showed and without silently losing activity that occurred while it was disconnected.

While the live stream is not connected, the chat SHALL show that where the streaming output
itself is — not only in the app-level connection banner — using the run stream's connection
state (`live-streams/connection-state`), distinguishing the device being offline from the server
being unreachable, and SHALL offer a manual retry. The notice SHALL disappear on its own once the
stream reconnects, without a reload, and SHALL NOT cover the composer or the phone bottom bar.

#### Scenario: Page reloaded mid-turn

- **WHEN** the human reloads the chat while a conductor turn is running
- **THEN** the chat shows the activity that turn has already produced and keeps appending new activity as it arrives

#### Scenario: Stream reconnects

- **WHEN** the live stream drops and reconnects during a turn
- **THEN** activity produced while disconnected is shown, and activity already shown is not duplicated

#### Scenario: No turn running

- **WHEN** the chat loads and the conductor is idle
- **THEN** no live region and no working indicator are shown, and the thread renders as before

#### Scenario: The live stream drops mid-turn

- **WHEN** the run event stream's connection is lost while a turn is being shown
- **THEN** the chat shows, next to the working indicator, that the live stream is reconnecting or
  offline and offers a manual retry, without waiting for the app-level banner alone to say so

#### Scenario: The live stream recovers

- **WHEN** the run event stream reconnects after having been shown as dropped
- **THEN** the notice disappears on its own, with no duplicated or missing activity and no reload

#### Scenario: The notice on a phone

- **WHEN** the run stream's connection notice is shown on the phone layout
- **THEN** it does not overlap or push away the composer or the bottom tab bar

### Requirement: The behavior holds on both human-facing chat surfaces

The working indicator, the streamed assistant text, the per-tool-call blocks, the single final reply and the mid-turn resumption SHALL apply to the web conductor chat and to the terminal conductor chat alike. The two surfaces MAY differ in presentation, but SHALL NOT differ in which activity they show.

A message the human sends, or a decision they answer from the chat, that cannot reach the daemon
SHALL never be silently dropped: it SHALL be queued for delivery on reconnect when the failure is
that the daemon cannot be reached, the same offline queue the composer already uses for a message
sent while the device itself is offline, or the human SHALL be told plainly that it was not sent.
A pending send SHALL NOT leave the working indicator showing indefinitely when it was never
delivered.

#### Scenario: Terminal chat during a turn

- **WHEN** a conductor turn runs while the terminal chat is open
- **THEN** the terminal chat shows the working state, the streamed assistant text and the tool-call blocks for that turn

#### Scenario: Reply suppression is consistent

- **WHEN** the conductor delivers a reply to the human during a turn
- **THEN** both surfaces omit that delivery from the live transcript, applying the same rule

#### Scenario: A message send fails because the daemon is unreachable

- **WHEN** the human sends a chat message while the device reports itself online but the request
  to the daemon fails to reach it
- **THEN** the message is queued for delivery on reconnect rather than discarded, and the working
  indicator is cleared rather than left showing forever

#### Scenario: Answering a decision from chat while disconnected

- **WHEN** the human answers a non-secret decision card shown inline in the chat while the chat
  cannot reach the daemon
- **THEN** the answer is queued for delivery on reconnect, the same way it would be from the Needs
  You list
