## ADDED Requirements

### Requirement: The skill steers a multi-image delivery to a gallery

The skill SHALL state a threshold above which a set of related images SHOULD become a single gallery
artifact rather than separate ticket attachments or a zip, and SHALL say how to lay the gallery out
(grouped sections, one caption per image). Below the threshold the existing pattern for one or two
captures SHALL be left unchanged. The skill SHALL also state, for a set too large to embed within the
artifact size cap, that images are downscaled and/or the set is split across galleries.

#### Scenario: A worker has many related screenshots
- **WHEN** a worker is about to deliver four or more images that belong together
- **THEN** the skill directs it to publish one gallery artifact, grouped and captioned, instead of
  attaching the images separately or as a zip

#### Scenario: A worker has one or two captures
- **WHEN** a worker is about to deliver a single screenshot or a two-capture before/after pair
- **THEN** the skill leaves the existing attachment-based pattern unchanged

#### Scenario: A set is too large to embed
- **WHEN** the images cannot all fit within the artifact size cap even when embedded
- **THEN** the skill says to downscale them and/or split the set across more than one gallery artifact,
  rather than attaching a zip

## MODIFIED Requirements

### Requirement: The skill's playbooks are original AC-specific text

The skill SHALL include playbooks for diagram, table, comparison, plan, code, change (before/after,
files changed, impact) and gallery (a labelled grid of related images that opens, pans and zooms)
artifacts, written as original text for AgentConductor rather than copied from another project's
documentation.

#### Scenario: Diagram discipline
- **WHEN** an agent follows the diagram playbook
- **THEN** it defaults to hand-authored inline SVG using `currentColor` and the kit's tokens rather
  than assembling a diagram out of flex/grid boxes, keeps labels short, and cites source locations as
  `path:line`

#### Scenario: A worker follows the gallery playbook
- **WHEN** an agent follows the gallery playbook
- **THEN** it builds a single self-contained document whose images are embedded once as `data:` URIs,
  each captioned, laid out as a grid whose cells open a full-viewport pannable and zoomable viewer with
  no JavaScript and no external reference
