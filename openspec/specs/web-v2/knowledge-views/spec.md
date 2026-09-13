# web-v2/knowledge-views Specification

## Purpose
The knowledge graph and the knowledge explorer as V2 screens, kept from V1 and restyled onto the Mono
primitives: the graph's force layout, filters and node opening, and the explorer's folder tree with its
inline document, hub, archive and artifact panes.

## Requirements

### Requirement: The knowledge graph works in V2 with V1's behaviour

The V2 app SHALL render the knowledge graph at `/v2/w/<ws>/knowledge/graph`. It SHALL keep V1's
behaviour and reuse V1's graph model, filters and layout logic rather than reimplementing them: hubs
and documents as nodes, `[[links]]` as edges, a force layout that can be dragged, zoomed, panned and
searched, node and style filters, and opening a node's document or hub. It SHALL draw and read its
colours from the V2 theme, so the graph follows the V2 dark and light tokens.

#### Scenario: Opening the graph

- **WHEN** a signed-in user opens `/v2/w/<ws>/knowledge/graph`
- **THEN** the V2 knowledge graph renders inside the V2 shell with the workspace `Knowledge` rail row
  highlighted

#### Scenario: V1's graph behaviour is kept

- **WHEN** the graph renders
- **THEN** its nodes, edges, filters, search and node opening behave as V1's graph does

#### Scenario: Opening a node

- **WHEN** the user opens a document node
- **THEN** that document's viewer opens

#### Scenario: The graph follows the theme

- **WHEN** the V2 theme switches between dark and light
- **THEN** the graph's colours are read from the V2 tokens and update with the theme

### Requirement: The knowledge explorer works in V2 with V1's behaviour

The V2 app SHALL render the document explorer at `/v2/w/<ws>/knowledge/explorer`. It SHALL keep V1's
behaviour and reuse V1's explorer tree logic and document viewers rather than reimplementing them: the
folder tree of documents and hubs, reading a document inline, reading and editing a hub with its
revisions, reading an archive file, and reading an artifact, with the reader and editing parity V1 has.

#### Scenario: Opening the explorer

- **WHEN** a signed-in user opens `/v2/w/<ws>/knowledge/explorer`
- **THEN** the V2 explorer renders inside the V2 shell with the workspace `Knowledge` rail row
  highlighted

#### Scenario: Browsing documents

- **WHEN** the explorer renders
- **THEN** its folder tree lists the workspace's and projects' documents and hub files as V1's does

#### Scenario: Reading and editing a document or hub

- **WHEN** the user selects a document or hub in the tree
- **THEN** it is shown inline, and a hub can be edited, reverted and curated through the existing
  knowledge mutations

### Requirement: The kept views stay frontend-only and leave V1 alone

The graph and explorer SHALL add no daemon, HTTP route, migration or config change and SHALL reuse the
existing `packages/ui/src/api` hooks and `packages/ui/src/lib` graph and explorer logic. V1 at `/` SHALL
remain unchanged and its tests SHALL keep passing.

#### Scenario: No backend change

- **WHEN** the graph and explorer render
- **THEN** they issue only the existing HTTP requests V1's versions already used

#### Scenario: V1 is unaffected

- **WHEN** V1's knowledge screens render
- **THEN** they behave exactly as before, with the V2 styles scoped to the V2 root
