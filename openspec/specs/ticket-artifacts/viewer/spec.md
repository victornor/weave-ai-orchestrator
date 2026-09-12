# ticket-artifacts/viewer Specification

## Purpose
Gives a human a place on the ticket page to browse, view, and take a published artifact away as a
standalone file, without leaving the ticket they were already looking at.

## Requirements

### Requirement: An artifact tab appears only when the ticket has artifacts
The ticket page SHALL show a dedicated artifact-viewing surface only when the ticket has at least one
published artifact, and SHALL NOT show it otherwise.

#### Scenario: A ticket with no artifacts
- **WHEN** a human opens a ticket that has never had an artifact published to it
- **THEN** the ticket page shows no artifact tab.

#### Scenario: A ticket gains its first artifact
- **WHEN** an agent publishes the first artifact to a ticket a human already has open
- **THEN** the artifact tab appears without the human needing to reload the page.

### Requirement: The viewer renders an artifact in a sandboxed frame with a list and revision picker
The artifact tab SHALL list every published artifact on the ticket with its title, kind, and last-
updated time, render the selected artifact in a sandboxed frame, and let the human pick among that
artifact's revisions, with an earlier revision remaining fully viewable.

#### Scenario: Selecting an artifact with multiple revisions
- **WHEN** a human selects an artifact that has been published more than once
- **THEN** the viewer offers a way to pick any prior revision, and selecting one renders that
  revision's content, not the current one.

### Requirement: A human can open, copy a link to, or download an artifact
The artifact tab SHALL offer actions to open the selected artifact in a new browser tab, copy a link
to it, and download it as a file.

#### Scenario: Downloading an artifact
- **WHEN** a human downloads an artifact from the viewer
- **THEN** the resulting file, opened directly from local disk with network access disabled, renders
  with the same AC visual styling as it did inside the viewer.

### Requirement: A downloaded artifact is self-contained even if its own HTML omitted the kit
The download action SHALL guarantee the AC design-kit styling is present in the downloaded file,
whether or not the stored HTML already embedded it.

#### Scenario: Downloading an artifact that already inlines the kit
- **WHEN** a human downloads an artifact whose stored HTML already embeds the AC design kit's styling
- **THEN** the downloaded file is unchanged from the stored bytes.

#### Scenario: Downloading an artifact that does not inline the kit
- **WHEN** a human downloads an artifact whose stored HTML does not embed the AC design kit's styling
- **THEN** the downloaded file has that styling added so it still renders with AC's visual language
  when opened standalone.
