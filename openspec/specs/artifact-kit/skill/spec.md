# artifact-kit/skill Specification

## Purpose
Teaches agents how and when to produce a rich HTML artifact, and gives them ready-made, original
playbooks for the common shapes instead of leaving each agent to invent format and structure from
scratch.

## Requirements

### Requirement: The artifacts skill exists and is discoverable
A skill named `agent-conductor-artifacts` SHALL exist under `skills/`, with a `SKILL.md` and a
`references/` directory, registered in `skills/manifest.json` with an audience and description, and
listed in `skills/README.md`'s table. At least one always-loaded prompt template SHALL name its
trigger, so an agent knows when to load it without carrying its content on every turn.

#### Scenario: Manifest and README list the skill
- **WHEN** the shipped skill set is installed into an agent's home, or `skills/manifest.json` is read
- **THEN** `agent-conductor-artifacts` appears with its audience and a one-line description, and the
  same skill appears in `skills/README.md`'s table.

#### Scenario: A template names the trigger
- **WHEN** an agent whose kind can produce artifacts reads its always-loaded prompt
- **THEN** it finds a line naming `agent-conductor-artifacts` and the condition under which it should
  be loaded.

### Requirement: The skill states when an artifact is warranted
The skill SHALL give a rule for when to produce an artifact versus when a ticket comment or existing
document is enough, so agents do not default to producing artifacts unnecessarily.

#### Scenario: A trivial fact
- **WHEN** an agent has a short factual answer or update to share
- **THEN** the skill's guidance directs it to a comment rather than an artifact.

### Requirement: The skill states the format rules
The skill SHALL require that an artifact be a single self-contained HTML document — inline CSS and
SVG, images as data URIs, no external fetches of any kind — built on the AC Artifact Kit rather than a
competing framework or component library.

#### Scenario: An agent drafts an artifact
- **WHEN** an agent follows the skill's format rules
- **THEN** the resulting document has no `<script src>` and no external `<link>`/`<img src>`
  reference to a non-`data:` URL, and uses the kit's classes and tokens for its visual language.

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

### Requirement: The skill states how an artifact reaches the human
The skill SHALL name the publishing tool and the resulting destination explicitly, covering a
ticket-bound agent, a weaver with no ticket, and a planning agent drafting a plan, so an agent never
has to guess or improvise (such as attaching the raw HTML file to a chat message) to deliver an
artifact it has authored. For the planning agent the skill SHALL state that the artifact belongs to
the plan rather than any repository or ticket, and that publishing it supplements the planner's reply
rather than replacing it.

#### Scenario: A worker with a ticket looks up how to publish
- **WHEN** a worker following the skill wants to deliver an artifact
- **THEN** the skill names the ticket-scoped publishing tool and states that the tool's returned URL,
  not the HTML itself, is what reaches the human

#### Scenario: A weaver with no ticket looks up how to publish
- **WHEN** a weaver following the skill wants to deliver an artifact in a chat reply
- **THEN** the skill names the workspace-scoped publishing tool available to it, states that it
  returns a URL rendered inside the web app, and states that this URL — not an attached HTML file — is
  what belongs in the chat message

#### Scenario: A planning agent looks up how to publish
- **WHEN** the planning agent following the skill wants to visualize the plan it is drafting
- **THEN** the skill names the plan-scoped publishing tool, states that the artifact is plan storage
  and not a repository write, and states that the planner must still answer through its own reply tool
  so the artifact supports the reply rather than replacing it

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
