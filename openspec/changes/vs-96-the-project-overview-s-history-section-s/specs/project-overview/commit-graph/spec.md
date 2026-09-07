## ADDED Requirements

### Requirement: The History section draws the project's commits as a branch graph

The project overview's History section SHALL render the project's commits as a graph: each commit on
one row, newest at the top, and a column of lanes to the left in which every commit sits in exactly
one lane, connected by lines to each of its parents.

A commit with more than one parent SHALL be drawn with a line to each parent's lane, so a merge is
visible as such. A commit whose child sits in a different lane SHALL be drawn with a line joining the
two, so a branch point is visible as such. A lane SHALL keep a stable colour and position for as long
as it is open, and lanes SHALL be assigned so that the same history always draws the same graph.

A commit whose parent is not among the commits shown SHALL have its line drawn to the edge of what is
shown rather than stopping without explanation.

#### Scenario: A linear history

- **WHEN** every commit shown has exactly one parent and one child
- **THEN** all of them are drawn in a single lane

#### Scenario: A merge

- **WHEN** a commit shown has two parents
- **THEN** it is drawn with a line to each parent's lane

#### Scenario: Two branches at once

- **WHEN** two branches carry commits over the same period
- **THEN** each branch's commits occupy their own lane and the branch point joins them

#### Scenario: The same history draws the same graph

- **WHEN** the same commits are laid out twice
- **THEN** every commit is placed in the same lane both times

#### Scenario: A parent below the last row

- **WHEN** a commit's parent is older than the oldest commit shown
- **THEN** its line is drawn to the edge of what is shown

### Requirement: Every row names its commit, and its ticket where one is known

Each row of the graph SHALL show the commit's subject, its author, how long ago it was authored, and
its abbreviated object name.

Where a commit carries refs, those refs SHALL be shown on its row, with the default branch
distinguished from the rest.

Where the branch a commit belongs to, or the commit's own message, names a ticket of this project,
that ticket's identifier SHALL be shown on the row and SHALL open that ticket. A row that names no
ticket SHALL show none rather than a guess.

#### Scenario: A row with a ticket

- **WHEN** a commit sits on a branch recorded for a ticket, or its message names a ticket identifier
- **THEN** the row shows that identifier and it opens the ticket

#### Scenario: A row with no ticket

- **WHEN** neither the commit's branch nor its message names a ticket
- **THEN** the row shows no ticket

#### Scenario: A tip

- **WHEN** a commit is the tip of one or more refs
- **THEN** those refs are shown on its row, the default branch distinguishably

### Requirement: More history loads as the reader goes on

The History section SHALL show a first page of commits as soon as the project's overview is opened,
and SHALL load further commits as the reader reaches the end of what is shown, without a reload and
without losing the reader's position.

While more is loading the section SHALL say so; when there is no more it SHALL say that too. A
failure to read the history SHALL be shown as a failure with a way to try again, and SHALL NOT be
shown as an empty history.

#### Scenario: Reaching the end of the page

- **WHEN** the reader reaches the last commit shown and more exist
- **THEN** the next commits are appended below, in the same lanes

#### Scenario: The whole history is shown

- **WHEN** every commit reachable from the covered refs is shown
- **THEN** the section says there is no more

#### Scenario: The history cannot be read

- **WHEN** reading the project's repository fails
- **THEN** the section says so and offers to try again, and does not claim the project has no commits

### Requirement: Selecting a commit shows what it changed

Selecting a commit in the graph SHALL show that commit's detail: its full message, its author and
when it was authored, and every file it changed with that file's added and removed line counts. The
selected commit SHALL be marked as selected in the graph.

Where the project's remote is a forge whose commit addresses are known, the detail SHALL offer a link
to that commit on the forge. Where it is not, no link SHALL be offered rather than a broken one.

#### Scenario: A commit is selected

- **WHEN** a commit's row is selected
- **THEN** its full message and its changed files with their added and removed line counts are shown

#### Scenario: A project on a known forge

- **WHEN** the selected commit belongs to a project whose remote is a recognised forge
- **THEN** the detail offers a link to that commit on the forge

#### Scenario: A project with no recognised forge

- **WHEN** the project's remote is not a recognised forge
- **THEN** no forge link is offered

### Requirement: Selecting a branch shows whose it is

The section SHALL list the refs its graph covers, and selecting one SHALL highlight that branch's
lane in the graph and bring its tip into view.

A selected branch SHALL show whether it belongs to a ticket and, where a worker holds it, which
worker — with links to both. A branch that belongs to no ticket SHALL say so plainly.

#### Scenario: A worker's branch

- **WHEN** a branch a worker holds is selected
- **THEN** its lane is highlighted and the ticket and the worker are named and can be opened

#### Scenario: The default branch

- **WHEN** the default branch is selected
- **THEN** its lane is highlighted and it is shown as belonging to no ticket

### Requirement: The graph keeps up with the project without a reload

The History section SHALL refresh itself from the same live event stream the rest of the overview
uses, so that a branch appearing, a branch going away, a ticket landing or a worker starting or
finishing is reflected without the reader reloading the page.

Refreshing SHALL keep the reader's place: the pages already loaded SHALL NOT collapse back to the
first, and a selected commit SHALL stay selected if it still exists.

#### Scenario: A worker starts on a new branch

- **WHEN** a worker is spawned on a branch of this project
- **THEN** the graph shows that branch without the page being reloaded

#### Scenario: A ticket lands

- **WHEN** a ticket of this project is merged
- **THEN** the graph shows the landing without the page being reloaded

#### Scenario: The reader's place is kept

- **WHEN** the graph refreshes while the reader has loaded several pages
- **THEN** those pages are still shown and the selected commit is still selected

### Requirement: The graph is usable on a phone and on a desktop

On a narrow viewport the graph SHALL compress: the lane column SHALL be bounded to a width that
leaves the subject readable, lanes beyond what fits SHALL be folded into the bound rather than
pushing the row off screen, and a selected commit's detail SHALL open as a sheet over the page rather
than beside it.

On a wide viewport the detail SHALL be shown beside the graph, and the graph SHALL keep its lanes.

Neither layout SHALL require the reader to scroll horizontally to read a commit's subject.

#### Scenario: A narrow viewport

- **WHEN** the section is shown on a phone-width viewport
- **THEN** the lane column is bounded, the subject stays readable, and a selected commit opens as a
  sheet

#### Scenario: A wide viewport

- **WHEN** the section is shown on a desktop-width viewport
- **THEN** the selected commit's detail is shown beside the graph

#### Scenario: More lanes than fit

- **WHEN** the history has more concurrent lanes than the bounded column can draw
- **THEN** the extra lanes are folded into the bound and no row is pushed off screen
