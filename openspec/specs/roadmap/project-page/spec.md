# roadmap/project-page Specification

## Purpose
Puts a project's roadmap on its V2 project page: the future ideas for that project, in the order
captain set, editable in place, updating live when the weaver changes them from chat, and explaining
itself when empty.

## Requirements

### Requirement: The V2 project page has a Roadmap section

The V2 project overview SHALL include a Roadmap section, added to `V2_PROJECT_SECTIONS` so it is
rendered under the same section contract as the page's other sections, showing the roadmap of the
project the page is about and no other project's.

The section SHALL list the project's items in their order, each showing its title, its status
(`idea`, `planned` or `dropped`), its notes as markdown, and — when it has one — its linked ticket as
a link to that ticket. It SHALL use V2's existing styling and components and SHALL be reachable at
the page's section anchor.

#### Scenario: Items are shown in order with their fields

- **WHEN** a project has roadmap items in all three statuses, one with a linked ticket
- **THEN** the Roadmap section lists them in order, each with its title and status, the notes
  rendered as markdown, and the linked item linking to its ticket

#### Scenario: Another project's items do not appear

- **WHEN** the page is about project A
- **THEN** the Roadmap section shows only project A's items

### Requirement: The roadmap is editable in place

The section SHALL let a person add an item, edit an item's title and notes, reorder it within the
project, change its status between `idea`, `planned` and `dropped`, and delete it — without leaving
the project page. Each action SHALL call the roadmap routes and SHALL reflect the result in the
section.

#### Scenario: Add

- **WHEN** a title is entered and the add action is used
- **THEN** the new item appears in the list without a reload

#### Scenario: Edit and change status

- **WHEN** an item's title or notes are changed, or its status is set to `planned`
- **THEN** the list shows the new title, notes and status

#### Scenario: Reorder

- **WHEN** an item is moved up or down
- **THEN** the list shows it in its new position, and the order persists on reload

#### Scenario: Delete

- **WHEN** an item is deleted
- **THEN** it is no longer in the list

### Requirement: The roadmap updates live and explains an empty state

The section SHALL update when the roadmap changes elsewhere — in particular when the weaver adds,
edits, reorders or removes an item through the roadmap tools — without a reload, driven by the same
workspace event stream the rest of the app uses. A project whose roadmap is empty SHALL show an empty
state saying what the roadmap is for and how an item gets onto it.

#### Scenario: A change by the weaver appears live

- **WHEN** the weaver adds a roadmap item for the project while its page is open
- **THEN** the section shows the new item without a manual reload

#### Scenario: Empty state

- **WHEN** a project has no roadmap items
- **THEN** the Roadmap section shows an empty state explaining what the roadmap holds and how to add
  an item
