## MODIFIED Requirements

### Requirement: An artifact tab appears only when the ticket has artifacts
The ticket page SHALL show a dedicated artifact-viewing surface only when the ticket has at least one
`type = 'artifact'` work product, and SHALL NOT show it otherwise. Within the tab, an artifact backed
by a stored artifact document is presented for viewing; a `type = 'artifact'` work product with no
stored document SHALL be presented as a plain work-product link only.

#### Scenario: A ticket with no artifacts
- **WHEN** a human opens a ticket that has never had an artifact published to it
- **THEN** the ticket page shows no artifact tab.

#### Scenario: A ticket gains its first artifact
- **WHEN** an agent publishes the first artifact to a ticket a human already has open
- **THEN** the artifact tab appears without the human needing to reload the page.

#### Scenario: A ticket whose only artifact row is link-only
- **WHEN** a human opens a ticket whose only `type = 'artifact'` work product has no stored artifact
  document
- **THEN** the artifact tab presents it as a plain work-product link with its URL, and does not mount
  a preview frame or a Download action for it

### Requirement: The viewer renders an artifact in a sandboxed frame with a list and revision picker
The artifact tab SHALL list every artifact work product on the ticket with its title, kind, and last-
updated time, render each published artifact in a sandboxed frame, and let the human pick among that
artifact's revisions, with an earlier revision remaining fully viewable. A work product with no
stored artifact document SHALL NOT be rendered in the frame; it SHALL appear only as a plain link
labelled with its URL.

#### Scenario: Selecting an artifact with multiple revisions
- **WHEN** a human selects an artifact that has been published more than once
- **THEN** the viewer offers a way to pick any prior revision, and selecting one renders that
  revision's content, not the current one.

#### Scenario: A link-only row is not rendered as a preview
- **WHEN** the artifact tab contains a `type = 'artifact'` work product with no stored artifact
  document, whose URL is a `file://` path
- **THEN** the row is shown as a plain link displaying that URL, and no iframe is mounted for it

## ADDED Requirements

### Requirement: The viewer never fakes a preview
When the artifact viewer receives an empty URL, or a URL that is not a same-origin `/api/w/…/raw`
artifact serve path, it SHALL render an explicit "this artifact has no stored content to preview"
state and SHALL disable (or omit) the Download and Open-in-new-tab actions. It SHALL NEVER render an
iframe whose `src` is empty or a non-`/api/w/…/raw` URL.

#### Scenario: An empty URL
- **WHEN** the viewer is given an artifact whose URL is empty
- **THEN** it shows the no-stored-content state and offers no enabled Download or Open action, and
  mounts no iframe

#### Scenario: A non-raw URL
- **WHEN** the viewer is given an artifact whose URL is a `file://` path rather than an
  `/api/w/…/raw` serve path
- **THEN** it shows the no-stored-content state and mounts no iframe

#### Scenario: A published artifact still previews
- **WHEN** the viewer is given an artifact whose URL is its `/api/w/…/raw` serve path
- **THEN** it renders the sandboxed frame and the Download and Open actions exactly as before

### Requirement: A failed artifact download is visible
If the download action's fetch or file construction fails, the viewer SHALL surface an error to the
human rather than failing silently.

#### Scenario: The download fetch fails
- **WHEN** a human clicks Download and the artifact's raw HTML cannot be fetched
- **THEN** the viewer shows an error indicating the download failed, and does not leave the button
  in a permanently busy state
