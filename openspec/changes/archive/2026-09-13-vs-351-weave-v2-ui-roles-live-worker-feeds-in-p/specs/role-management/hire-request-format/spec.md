# role-management/hire-request-format Specification

## Purpose
The chat-message format the Hire a role modal sends, and the rule that lets the weaver recognise it
as a hire request for a project without a command parser or a new endpoint.

## ADDED Requirements

### Requirement: A `/hire-role` chat message is a hire request for its project

The hire skill SHALL define that a human message whose first line is
`/hire-role project=<project slug>` — followed by a blank line and a description of what the role
should own — is a hire request for that project. A weaver receiving that format SHALL treat it as a
hire request: identify the project by its slug, then follow the existing hiring flow (overlap check,
draft the role spec and charter, and submit the hire). The format SHALL be handled as ordinary
conversation rather than a parsed command; no command parser, endpoint or tool SHALL be required to
recognise it.

#### Scenario: The weaver recognises the format

- **WHEN** a message beginning `/hire-role project=infra` arrives in the weaver's chat
- **THEN** the weaver treats it as a hire request for the project with slug `infra`, not as an
  unclassifiable message

#### Scenario: The description drives the role

- **WHEN** the hire request carries a description of what the role should own
- **THEN** the weaver drafts the role's spec and charter from that description, applying the normal
  overlap check against the project's existing roles

### Requirement: The hire still returns to the human for approval

The `/hire-role` request SHALL NOT bypass hire approval. The weaver SHALL submit the drafted role
through the existing hire flow, so that when hire approval is `human` the role stays
`pending_activation` until the human confirms, and the charter is approved before any worker runs.

#### Scenario: The charter waits for approval

- **WHEN** a `/hire-role` request is handled in a workspace whose hire approval is `human`
- **THEN** the role is created awaiting approval and no worker runs until the human approves the
  charter
