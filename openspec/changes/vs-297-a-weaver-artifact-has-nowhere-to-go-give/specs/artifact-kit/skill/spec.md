## ADDED Requirements

### Requirement: The skill states how an artifact reaches the human
The skill SHALL name the publishing tool and the resulting destination explicitly, covering both a
ticket-bound agent and a weaver with no ticket, so an agent never has to guess or improvise (such as
attaching the raw HTML file to a chat message) to deliver an artifact it has authored.

#### Scenario: A worker with a ticket looks up how to publish
- **WHEN** a worker following the skill wants to deliver an artifact
- **THEN** the skill names the ticket-scoped publishing tool and states that the tool's returned URL,
  not the HTML itself, is what reaches the human

#### Scenario: A weaver with no ticket looks up how to publish
- **WHEN** a weaver following the skill wants to deliver an artifact in a chat reply
- **THEN** the skill names the workspace-scoped publishing tool available to it, states that it
  returns a URL rendered inside the web app, and states that this URL — not an attached HTML file — is
  what belongs in the chat message
