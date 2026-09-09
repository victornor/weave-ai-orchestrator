## ADDED Requirements

### Requirement: Titled https links in chat are compact buttons

A markdown link in a conductor-chat message whose target is an `https:` URL
SHALL be shown as a compact button: the link text is the visible label and
the URL is not shown in the paragraph. Tapping or clicking the button SHALL
open that URL.

Several such buttons in one message SHALL all appear, wrapping onto following
lines at phone width rather than overflowing the message.

A markdown link whose target is not an `https:` URL SHALL NOT be shown as one
of these buttons. Ticket-identifier links and knowledge document links SHALL
keep the appearance they already have.

The stored message body SHALL remain the markdown that was submitted. This
treatment is display only.

The conductor SHALL have a documented way to author these buttons as markdown
in the outbound message body (`[label](https://…)`), without a separate
structured field.

#### Scenario: A titled https link in a conductor reply

- **WHEN** a conductor-chat message whose body contains `[GitHub pull request 130](https://github.com/acme/repo/pull/130)` is shown
- **THEN** the label "GitHub pull request 130" is shown as a compact button, the URL is not shown as paragraph text, and activating the button opens `https://github.com/acme/repo/pull/130`

#### Scenario: Several titled links in one reply

- **WHEN** a conductor-chat message contains two `https:` markdown links with different labels
- **THEN** both labels appear as compact buttons in that message

#### Scenario: A non-https markdown link is not a button

- **WHEN** a conductor-chat message contains a markdown link whose target is not an `https:` URL
- **THEN** that link is not shown as one of these buttons

#### Scenario: Authoring stays markdown in the body

- **WHEN** the conductor sends a reply that should include a titled link button
- **THEN** the stored body is markdown of the form `[label](https://url)`, and reading the message back returns that body unchanged
