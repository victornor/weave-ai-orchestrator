# workspace-navigation/worker-model-tags Specification

## Purpose
When a workspace runs tickets on more than one model tier, the board and the live view say which tier each ticket is on: a small tag carrying the worker model option's id, derived from what is configured at render time, with tickets on the workers default labelled rather than left untagged.

## Requirements

### Requirement: The board shows each ticket's worker model tier when several are configured

When more than one worker model option is configured for the workspace, the board surfaces that show a ticket as work — the kanban card, the phone row and the table row — SHALL each display a small tag whose text is the id of the worker model option the ticket names. When zero or one worker model option is configured, the board SHALL NOT display the tag anywhere. Whether the tag shows SHALL be derived from the configured options at render time; it SHALL NOT come from a hardcoded count or a hardcoded list of ids.

#### Scenario: A ticket's tier is visible on its card

- **WHEN** the workspace has two or more worker model options configured and a board card's ticket names the option `deep`
- **THEN** that card shows a tag reading `deep`

#### Scenario: One configured option means no tags

- **WHEN** the workspace has exactly one worker model option configured
- **THEN** no board surface shows a model tag

#### Scenario: The gate follows the configured options

- **WHEN** the workspace's configured options change between one and several while the page is open
- **THEN** the tags appear or disappear to match, without a deploy or an app update

### Requirement: The live view cell shows the same tier

A live view cell for a worker on a ticket SHALL show the same tag the board shows for that ticket — same text, same visibility rule — when more than one worker model option is configured. This holds on the workspace's Live page and on the daemon-wide Live page.

#### Scenario: A cell shows its ticket's tier

- **WHEN** a worker is live on a ticket that names the option `standard`, and two or more options are configured
- **THEN** that worker's cell shows a tag reading `standard`

#### Scenario: A cell hides the tag with one option

- **WHEN** exactly one worker model option is configured
- **THEN** no live cell shows a model tag

#### Scenario: Board and live agree

- **WHEN** the same ticket's board card and its live cell are shown with tags visible
- **THEN** both carry the same tag text

### Requirement: A ticket on the workers default is labelled, not blank

When the tag is showing and a ticket stores no worker model option id, its tag SHALL read `default`. A ticket whose stored id is no longer in the effective catalog SHALL also read `default`, because that is the setting its next worker turn resolves to. Once the tag is showing, a ticket shown as work SHALL NOT appear without one.

#### Scenario: A ticket with no option id reads as the default

- **WHEN** a ticket stores no worker model option id while two or more options are configured
- **THEN** its board card and live cell show a tag reading `default`

#### Scenario: A removed option reads as the default

- **WHEN** a ticket names an option that has been removed from the configured catalog
- **THEN** its tag reads `default`, matching the workers setting its next turn runs on

### Requirement: The tag is small and identical across surfaces

The tag SHALL be rendered by one shared component everywhere it appears, in the card or cell's secondary annotation row rather than beside the title. It SHALL NOT displace, shrink or crowd what the card or cell already shows: every element visible before this change remains visible. At the smallest live cell size, the tag SHALL still render without clipping, and the cell's agent name, ticket link and status SHALL remain intact.

#### Scenario: The smallest cell still reads

- **WHEN** a live cell is at its smallest size while the tag is showing
- **THEN** the tag renders, and the cell's agent name, ticket link and status badge are all still present and readable

#### Scenario: Existing card content is unmoved

- **WHEN** tags are showing on the board
- **THEN** every element a board card showed before this change — identifier, title, kind, status badges, worker name, age — is still shown, asserted by the existing card tests passing unchanged
