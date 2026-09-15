## ADDED Requirements

### Requirement: Each project carries a Roadmap sub-link in the rail and the phone list

Under each project in the desktop rail, the app SHALL show a secondary, indented **Roadmap** child
row linking to that project's roadmap page, visually subordinate to the project row and using V2's
existing row styling. The phone More list, which lists no projects today, SHALL list each project of
the current workspace with the same Roadmap child row. Activating the project's roadmap SHALL
highlight that project's row, exactly as visiting the project overview does. A project's roadmap row
SHALL be reachable by keyboard like every other navigation row.

#### Scenario: The rail's project rows

- **WHEN** the rail renders a workspace's projects
- **THEN** each project row is followed by an indented Roadmap child row linking to that project's
  roadmap page

#### Scenario: The phone More list

- **WHEN** a phone-width app opens More
- **THEN** the current workspace's projects are listed, each with its Roadmap child row

#### Scenario: The project row highlights on its roadmap

- **WHEN** a project's roadmap page is shown
- **THEN** that project's row is the highlighted rail row

#### Scenario: The child row is keyboard reachable

- **WHEN** the rail or the More list is navigated by keyboard
- **THEN** the project's Roadmap row can be reached and activated
