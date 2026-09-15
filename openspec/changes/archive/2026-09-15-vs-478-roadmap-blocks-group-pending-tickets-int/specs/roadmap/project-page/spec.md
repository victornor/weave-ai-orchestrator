## MODIFIED Requirements

### Requirement: The V2 project page has a Roadmap section

The V2 project overview SHALL include a Roadmap section, added to `V2_PROJECT_SECTIONS` so it is rendered under the same section contract as the page's other sections, showing the roadmap of the project the page is about and no other project's.

The section SHALL list the project's items in their order, each showing its title, its status (`idea`, `planned` or `dropped`), its notes as markdown, and — when it has one — its linked ticket as a link to that ticket. An item assigned to a block SHALL show that block's title beside it. The section SHALL offer a link to the project's full Roadmap page. It SHALL use V2's existing styling and components and SHALL be reachable at the page's section anchor.

#### Scenario: Items are shown in order with their fields

- **WHEN** a project has roadmap items in all three statuses, one with a linked ticket and one in a block
- **THEN** the Roadmap section lists them in order, each with its title and status, the notes rendered as markdown, the linked item linking to its ticket, and the blocked item naming its block

#### Scenario: Another project's items do not appear

- **WHEN** the page is about project A
- **THEN** the Roadmap section shows only project A's items

#### Scenario: The section reaches the full page

- **WHEN** the Roadmap section renders
- **THEN** it offers a link to the project's Roadmap page
