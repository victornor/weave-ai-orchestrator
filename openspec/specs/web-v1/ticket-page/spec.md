# web-v1/ticket-page Specification

## Purpose
The V1 ticket page at `/w/$ws/tickets/$ticketId` is where a ticket's details, its live conversation,
its work products, its usage and the knowledge its runs consumed are read together, with the plan —
and a published artifact, when there is one — kept as separate tabs. This capability fixes that
tab set and the one-page Overview layout that carries those five subjects, so the human reads a
ticket in one scroll instead of clicking between panes.

## Requirements

### Requirement: The ticket page has Overview and Plan tabs, plus Artifacts when the ticket has one

The ticket page's tab bar SHALL show **Overview** and **Plan** always, and **Artifacts** only when
the ticket has at least one `type = 'artifact'` work product. It SHALL NOT show separate Activity,
Work, Usage or Knowledge tabs. The Overview tab SHALL be the page's default, whatever the ticket
contains; the Artifacts tab SHALL open only when it is named.

The selected tab SHALL be addressable through the page's `?tab=` search value, which SHALL accept
`overview`, `plan` and `artifacts`.

#### Scenario: A ticket without artifacts
- **WHEN** a ticket with no artifact work product is opened
- **THEN** its tab bar shows Overview and Plan, and no Artifacts tab

#### Scenario: A ticket with an artifact
- **WHEN** a ticket that has at least one `type = 'artifact'` work product is opened
- **THEN** its tab bar shows Overview, Plan and Artifacts

#### Scenario: The default tab
- **WHEN** a ticket is opened with no `?tab=` value
- **THEN** the page opens on Overview, even when the ticket has an artifact

#### Scenario: A named tab opens directly
- **WHEN** a ticket is opened with `?tab=plan` or `?tab=artifacts`
- **THEN** the page opens on that tab

### Requirement: The Overview tab is one scrolling page of four ordered rows

The Overview tab SHALL render, in a single scroll, four rows in this order:

1. a two-pane split — on the left the ticket's details (its description, ticket and delivery facts,
   blockers and any decision it shows), on the right its live activity (the comment and turn feed,
   any merge decision and the reply composer);
2. the ticket's Work content (work products, OpenSpec task progress, worktree and runs);
3. the ticket's Usage content (token, cost, run and duration figures and its runs);
4. the ticket's Knowledge content (the hub and documents its runs read).

On a wide viewport the activity pane in row 1 SHALL scroll independently of the page, so a long feed
does not push rows 2 to 4 out of reach. Below a sensible width the two panes SHALL stack with the
ticket details above the activity.

#### Scenario: The rows in order
- **WHEN** the Overview tab is open
- **THEN** the details-and-activity split appears first, then Work, then Usage, then Knowledge

#### Scenario: A long activity feed
- **WHEN** the ticket has more comments and turns than fit the activity pane and the viewport is wide
- **THEN** the activity pane scrolls within itself and the Work, Usage and Knowledge rows stay
  reachable below

#### Scenario: A narrow viewport
- **WHEN** the Overview tab is shown below the stacking width
- **THEN** the ticket details are above the activity, and the page scrolls as one column

#### Scenario: The composer is on the merged page
- **WHEN** the Overview tab is open on a ticket with a live worker
- **THEN** the activity pane carries the reply composer as the Activity tab did

### Requirement: Old tab deep links land on the merged Overview

The page SHALL continue to accept the pre-merge `?tab=` values `activity`, `work`, `usage` and
`knowledge`: each SHALL open the Overview tab and SHALL bring the section it named into view where
practically possible. An unrecognised `?tab=` value SHALL fall back to Overview. Any existing link
that opens a ticket on one of the old values SHALL therefore still reach the content it meant.

#### Scenario: A link to the conversation
- **WHEN** a ticket is opened with `?tab=activity`
- **THEN** the page shows Overview with the activity pane in view, and Overview is the selected tab

#### Scenario: A link to work, usage or knowledge
- **WHEN** a ticket is opened with `?tab=work`, `?tab=usage` or `?tab=knowledge`
- **THEN** the page shows Overview scrolled to that section, and Overview is the selected tab

#### Scenario: An unknown tab
- **WHEN** a ticket is opened with an unrecognised `?tab=` value
- **THEN** the page opens on Overview at the top

### Requirement: The merged page keeps the actions the separate tabs offered

Every action reachable from the pre-merge tabs SHALL remain reachable from the merged Overview and
SHALL call the same endpoint or contract it called before: replying to or steering a live worker
through the activity composer, approving or revising an open plan or merge decision, retrying or
resuming a parked worker, and toggling auto-merge.

#### Scenario: Replying to a live worker
- **WHEN** the human sends a message from the merged Overview's activity composer to a live worker
- **THEN** it is delivered through the same live-input path the Activity tab used

#### Scenario: Approving a merge
- **WHEN** a merge approval is open and the human approves it from the merged Overview
- **THEN** the decision is answered exactly as it was from the Activity tab

#### Scenario: Retry and auto-merge
- **WHEN** the human retries a parked worker or toggles auto-merge from the merged Overview
- **THEN** each calls the same endpoint it called before the merge

### Requirement: Rendering the whole Overview opens no extra live work

Rendering every row at once SHALL NOT open more than one live event stream per running run, and
SHALL NOT refetch a query in a loop. A turn's transcript SHALL still be fetched or streamed only when
the turn is expanded, exactly as before the merge.

#### Scenario: One running turn, one stream
- **WHEN** the Overview tab renders a ticket with a running turn
- **THEN** exactly one event stream is opened for that run

#### Scenario: A collapsed finished turn
- **WHEN** the Overview tab renders a finished turn that has not been expanded
- **THEN** no transcript is fetched and no stream is opened for it
