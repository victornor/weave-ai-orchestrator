# web-v2/chat — delta

## ADDED Requirements

### Requirement: Chat renders a tab strip with the weaver conversation as a tab

The V2 Chat screen SHALL render a tab strip above the conversation area. The weaver conversation
SHALL be a tab, selected when the screen opens unless a plan tab was the last-focused tab in the
workspace, and the weaver tab SHALL render the screen's existing status bar, conversation,
decisions pane and composer unchanged. The strip SHALL carry a **New plan** control and one tab per
drafting plan in the workspace, each tagged with its project, as specified by
`planning-sessions/v2-modal`.

#### Scenario: The weaver tab is present and selected

- **WHEN** Chat is opened with no plan tab remembered as focused
- **THEN** the strip's first tab is the weaver conversation and it is the selected tab

#### Scenario: The weaver tab renders today's chat

- **WHEN** the weaver tab is selected
- **THEN** the status bar, conversation, decisions pane and composer render exactly as they did
  before the tab strip existed

#### Scenario: The strip carries the plan tabs and New plan

- **WHEN** the workspace has drafting plans, across one or more projects
- **THEN** the strip shows a tab per drafting plan after the weaver tab, each tagged with its
  project, and a **New plan** control

### Requirement: The tab strip never overflows at narrow widths

The tab strip SHALL scroll horizontally when its tabs exceed the available width and SHALL NOT wrap
or push the **New plan** control out of reach. On a phone-sized viewport the tabs SHALL remain
selectable by scrolling the strip, and the conversation area SHALL keep the width it had with a
single tab.

#### Scenario: Many tabs on a narrow screen

- **WHEN** several plan tabs are open at a phone-sized viewport
- **THEN** the strip scrolls horizontally, its tabs stay selectable, and the page does not overflow

#### Scenario: The New plan control stays reachable

- **WHEN** the tab strip is too narrow to show every tab
- **THEN** the **New plan** control remains reachable without scrolling past the last tab
