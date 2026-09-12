## ADDED Requirements

### Requirement: Global Needs you renders its cards with no active workspace

The daemon-wide Needs you page SHALL render its decision cards for a person who has not selected an
active workspace, including decision kinds whose cards carry a plan preview or a document preview.
Rendering a card SHALL NOT require an active workspace to exist.

A card's plan preview or document preview SHALL read its document from the workspace the card's
decision belongs to, identified by the card's own workspace, and SHALL NOT read it from whichever
workspace was last active. A preview that cannot be read SHALL be reported on its own card and SHALL
NOT prevent the card, the other cards, or the page from rendering.

#### Scenario: A plan approval renders with no active workspace

- **WHEN** the daemon hosts a workspace with an open human-owned `plan_approval` decision and the
  human opens the daemon-wide Needs you page without having an active workspace
- **THEN** the page shows the plan-approval card and its plan preview rather than an error page

#### Scenario: A decision that targets a document renders with no active workspace

- **WHEN** an open human-owned decision carries a document reference and the human opens the
  daemon-wide Needs you page without having an active workspace
- **THEN** the page shows the card and its document preview rather than an error page

#### Scenario: A preview loads from the card's own workspace

- **WHEN** decisions from more than one workspace are waiting and the last active workspace is not
  the one a card belongs to
- **THEN** that card's plan or document preview is read from the workspace the decision belongs to

#### Scenario: An unreadable preview does not blank the page

- **WHEN** a card's plan or document cannot be read
- **THEN** that card says the document is missing and the other cards on the page still render

### Requirement: A test guards global card rendering against a missing workspace context

The web app's tests SHALL include a test that mounts the daemon-wide Needs you page with no active
workspace and at least one decision awaiting, using the page's real cards and the hooks they call
rather than substitutes, and that fails if any part of that subtree requires a workspace context the
page does not provide. The test SHALL cover at least a `plan_approval` decision and a decision that
carries a document reference.

#### Scenario: A new hook that requires a workspace context fails the test

- **WHEN** a hook reachable from the daemon-wide Needs you page starts requiring a workspace context
  the page does not provide
- **THEN** the guard test fails instead of the page rendering an error for the human

#### Scenario: The guard passes for the current cards

- **WHEN** the guard test mounts the page with a plan approval and a document-targeted decision and
  no active workspace
- **THEN** both cards and their previews render and the test passes
