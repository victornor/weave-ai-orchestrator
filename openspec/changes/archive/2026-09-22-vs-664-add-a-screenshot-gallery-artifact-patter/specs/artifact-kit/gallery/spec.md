## Purpose

A CSS-only image gallery the AC Artifact Kit ships, so a self-contained artifact can present a large
set of related images as a labelled thumbnail grid whose cells open into a full-viewport, pannable and
zoomable viewer — with no JavaScript and no resource from outside the document.

## ADDED Requirements

### Requirement: The kit ships a CSS-only image gallery

The kit SHALL define a gallery layout built only from CSS, without JavaScript: a labelled grid of
thumbnails, where following a thumbnail's link reveals that image in a full-viewport viewer over the
page, the viewer pans by scrolling, and a control zooms the image between fit-to-viewport and its
natural size using CSS state alone. The gallery SHALL render in both the dark-default and
`[data-theme='light']` themes using the kit's tokens, SHALL reference no resource outside a `data:`
URI, and SHALL embed each image's bytes once even though the same image is shown as both a thumbnail
and its enlarged view.

#### Scenario: A set of images lays out as a labelled grid
- **WHEN** a document built on the kit places several captioned images in the gallery layout
- **THEN** they render as a responsive grid of thumbnails, each with its caption, without any script
  running and without any reference to a non-`data:` URL

#### Scenario: A thumbnail opens a full-viewport viewer
- **WHEN** a reader follows a thumbnail's link
- **THEN** that image is shown large in a viewer filling the viewport, over the page, and the rest of
  the document is no longer the visible surface until the viewer is dismissed

#### Scenario: The open image pans and zooms without JavaScript
- **WHEN** the shown image is larger than the viewport, or the zoom control is toggled
- **THEN** the viewer scrolls to reach every part of the image, and the image switches between fitting
  the viewport and its natural size, driven only by CSS state

#### Scenario: Dismissing returns to the grid
- **WHEN** a reader dismisses the viewer
- **THEN** the gallery grid is the visible surface again and the page is otherwise unchanged

#### Scenario: Opened from disk with no network
- **WHEN** the gallery document is opened directly from the filesystem with network access disabled
- **THEN** it renders fully in the kit's styling, in the default and the `[data-theme='light']` theme,
  with no failed resource loads and no script execution

### Requirement: A worked gallery fixture is checked against the kit

The repository SHALL contain a worked example of the gallery pattern built on the kit, and an
automated check SHALL fail if the fixture uses a gallery class the kit does not define, embeds an
image the artifact validator rejects, or contains a script or a reference to a resource outside a
`data:` URI.

#### Scenario: The fixture uses only classes the kit defines
- **WHEN** the check extracts every gallery-related class the fixture uses
- **THEN** each one is found in the kit's CSS, so the fixture cannot drift from the classes agents are
  told to use

#### Scenario: The fixture is self-contained
- **WHEN** the check inspects the fixture
- **THEN** it finds no `<script>` element and no URL other than a `data:` URI

#### Scenario: The fixture's embedded images are valid
- **WHEN** the check runs the existing embedded-image validator over the fixture
- **THEN** every embedded raster data URI is complete and well formed

#### Scenario: Each image is embedded once
- **WHEN** the fixture shows an image as both a thumbnail and its enlarged view
- **THEN** that image's encoded bytes appear exactly once in the document
