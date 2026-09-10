# human-decisions/global-needs Specification

## Purpose
A daemon-wide Needs you page that lists every open decision awaiting the human across every
workspace this daemon hosts, using the same cards and actions as the per-workspace Needs you page,
reachable without picking a workspace first.

## Requirements

### Requirement: A global Needs you page lists every workspace's waiting decisions

The web app SHALL provide an addressable Needs you page at a path that does not include a workspace
id, reachable from the sidebar's global section and from the phone's More menu, without typing a
URL and without first choosing a workspace.

The page SHALL show every open decision awaiting the human (`owner: human`) in any workspace this
daemon hosts, as a card with the same question, the same options and the same actions as the
per-workspace Needs you page (`human-decisions/option-cards`). Each card SHALL name its workspace.
A decision hidden from that workspace's chat SHALL still appear here, as it does on per-workspace
Needs you.

Per-workspace Needs you at a workspace path SHALL keep working unchanged.

#### Scenario: Opening global Needs you from the sidebar

- **WHEN** the human activates Needs you in the sidebar's global section
- **THEN** the app shows the global Needs you page without a document reload and without making a
  workspace the active one

#### Scenario: Opening global Needs you from a phone

- **WHEN** the human opens More on a phone and chooses the global Needs you destination
- **THEN** the app shows the global Needs you page and the menu is dismissed

#### Scenario: Decisions from two workspaces appear together

- **WHEN** workspace Alpha has one open human-owned decision and workspace Beta has two, and global
  Needs you is open
- **THEN** the page shows exactly those three cards, each named with its workspace

#### Scenario: Same card, same actions

- **WHEN** a decision is waiting in Alpha
- **THEN** its card on the global page has the same question and the same options as Alpha's
  per-workspace Needs you card

#### Scenario: Per-workspace Needs you is unchanged

- **WHEN** the human activates Needs you inside a workspace group's section list
- **THEN** the app shows that workspace's Needs you page, not the global one

### Requirement: Answering a card records it in that workspace

Answering a card on the global page SHALL record the answer against that decision in its own
workspace, once. The card SHALL then leave the global list. The same decision SHALL no longer be
waiting in that workspace's Needs you or conductor chat. Answering SHALL NOT post to any other
workspace.

#### Scenario: A card in Alpha is answered

- **WHEN** the human answers a decision that belongs to workspace Alpha from the global page
- **THEN** the answer is recorded in Alpha, the card leaves the global list, and Alpha's
  per-workspace Needs you no longer shows it as waiting

#### Scenario: Beta is unaffected

- **WHEN** the human answers an Alpha decision from the global page while a Beta decision is also
  showing
- **THEN** the Beta decision remains waiting and is not posted to

### Requirement: Empty workspaces do not break the page

A workspace that has no open human-owned decision SHALL contribute no cards and SHALL NOT show an
error of its own. While any workspace's decisions have not yet loaded, the page SHALL show a
loading state distinguishable from empty. When every workspace has loaded and none has a waiting
decision, the page SHALL show a worded empty state. When one workspace's decisions cannot be
loaded, the page SHALL keep showing cards from the workspaces that did load and SHALL show that the
failed workspace could not load, with a way to retry that workspace; it SHALL NOT blank the whole
page. When the workspace list itself cannot be loaded, the page SHALL show an error and a way to
retry.

When a decision becomes waiting in any workspace, a card for it SHALL appear. When a decision is
answered or otherwise leaves the open set, its card SHALL disappear. None of these SHALL require a
document reload.

#### Scenario: Nothing needs the human anywhere

- **WHEN** every hosted workspace has loaded and no open human-owned decision exists
- **THEN** the page says so in words, with no cards

#### Scenario: One workspace is idle

- **WHEN** workspace A has a waiting decision and workspace B has none
- **THEN** the page shows A's card and does not show an error for B

#### Scenario: One workspace fails to load

- **WHEN** workspace A's decisions fail to load and workspace B's have loaded with a waiting
  decision
- **THEN** the page shows B's card, shows that A could not load, and offers retry for A
