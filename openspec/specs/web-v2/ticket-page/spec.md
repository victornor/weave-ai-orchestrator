# web-v2/ticket-page Specification

## Purpose
The V2 ticket page is the one place a ticket's description, plan, conversation, work products, usage
and artifacts are read together, and the place its kept V1 actions are taken.

## Requirements

### Requirement: The ticket page header names the ticket and its context

The ticket page at `/v2/w/$ws/tickets/$ticketId` SHALL render the ticket's identifier, kind tag,
status, title, its project tag in the project's own hue, the worker that holds or held it, and its
token/cost line. The header SHALL link back to Work for the ticket's workspace.

#### Scenario: A ticket's header

- **WHEN** a ticket with a project and a worker renders on the V2 ticket page
- **THEN** its identifier, kind, status, title, project tag, worker and token/cost line are shown in
  the header

#### Scenario: A missing ticket

- **WHEN** the ticket id in the address does not resolve
- **THEN** the page states the ticket was not found and offers a way back to Work

### Requirement: The ticket page has Overview, Plan and an optional Artifacts tab

The ticket page SHALL present at most three tabs: **Artifacts** (only when the ticket has at least one
published artifact, and the default tab when present, as before), then **Overview** and **Plan**. The
selected tab SHALL be addressable so a link can open the ticket on a named tab, accepting
`overview`, `plan` and `artifacts`; a link naming any former tab value (`activity`, `work`, `usage`,
`knowledge`) SHALL open Overview, so old links still land. With no named tab the page SHALL open on
Artifacts when the ticket has one and Overview otherwise. There SHALL be no separate Activity, Work,
Usage or Knowledge tab.

#### Scenario: The tab set

- **WHEN** a ticket with an artifact renders
- **THEN** its tabs are Overview, Plan and Artifacts, and no Activity, Work, Usage or Knowledge tab
  exists

#### Scenario: No artifact, no Artifacts tab

- **WHEN** a ticket has no published artifact
- **THEN** the Artifacts tab is not rendered and the page defaults to Overview

#### Scenario: An old tab value opens Overview

- **WHEN** a link addresses the ticket page with `?tab=activity`, `?tab=work`, `?tab=usage` or
  `?tab=knowledge`
- **THEN** the page opens on Overview

#### Scenario: A named tab opens directly

- **WHEN** a link addresses the ticket page with `?tab=plan`
- **THEN** the page opens on Plan

### Requirement: The Overview tab is one scrolling page in captain's section order

The Overview tab SHALL be a single scrolling page made of, in order:

1. a two-pane split — the **overview pane** on the left (description, ticket facts, delivery facts,
   blockers and the open retry decision) and the **Activity pane** on the right (the comments-and-turns
   feed in time order, the open merge decision and the reply composer);
2. then **Work** — the ticket's work products, its OpenSpec task progress when present, its worktree and
   branch, and its runs;
3. then **Usage** — its token, cost, run and duration figures and the per-turn table;
4. then **Knowledge** — the knowledge context (hub tokens, document tokens and the documents read) as
   its own section at the bottom.

At phone width the two panes SHALL stack in one column with the overview pane first. The Activity pane
SHALL scroll on its own, so a long feed does not push the rest of the page down.

#### Scenario: The Overview page's sections and order

- **WHEN** the user opens the Overview tab of a ticket with a description, comments, work products and
  usage
- **THEN** the page shows the two-pane overview/Activity split, then Work, then Usage, then Knowledge,
  in that order

#### Scenario: The Activity pane scrolls on its own

- **WHEN** the ticket has a long activity feed
- **THEN** the Activity pane scrolls independently rather than growing the page

#### Scenario: Phone stacking

- **WHEN** the ticket page renders at phone width
- **THEN** the overview pane and the Activity pane stack in one column with the overview pane first

#### Scenario: Knowledge is its own section

- **WHEN** the ticket's runs read knowledge
- **THEN** the hub tokens, document tokens and documents read appear in the Knowledge section of
  Overview, not inside Usage

### Requirement: The ticket page keeps V1's ticket actions

The V2 ticket page SHALL keep, restyled and reachable from the ticket header (an overflow menu or
equivalent), the ticket actions V1 supports through existing endpoints, and each SHALL call that
existing endpoint:

- the **auto-merge toggle** (`PATCH /tickets/:id`),
- **priority** (`PATCH /tickets/:id`),
- **retry** or resume for a parked or blocked worker (`POST /tickets/:id/retry`),
- **cancel** the ticket (`POST /tickets/:id/cancel`),
- **discard** the ticket's unlanded work (`POST /tickets/:id/discard`),
- **reassign** to a role (`POST /tickets/:id/assign`), and
- **blockers** (`PUT /tickets/:id/blockers`).

An action SHALL reflect its result: a mutation that changes the ticket SHALL update the rendered
ticket.

#### Scenario: The auto-merge toggle works

- **WHEN** the user toggles auto-merge on the ticket page
- **THEN** the ticket's auto-merge value is patched through the existing endpoint and the rendered
  toggle reflects the new value

#### Scenario: Cancel works

- **WHEN** the user cancels the ticket from the ticket page
- **THEN** the ticket is cancelled through the existing endpoint and the rendered status reflects it

#### Scenario: Discard works

- **WHEN** the user discards the ticket's work from the ticket page
- **THEN** the discard is requested through the existing endpoint

#### Scenario: Retry works

- **WHEN** the ticket is blocked or its worker is parked and the user activates retry
- **THEN** the retry is requested through the existing endpoint

#### Scenario: Reassign and blockers are reachable

- **WHEN** the user opens the ticket actions
- **THEN** reassign and blockers are reachable and call their existing endpoints

### Requirement: The ticket page renders artifacts inline above the fold

The ticket page's Artifacts tab SHALL render the ticket's published artifacts inline, above the fold,
rather than behind a link. When a ticket has more than one artifact the tab SHALL offer a way to
choose among them. An artifact with no stored content SHALL be shown as a link-only row rather than a
blank frame. The tab SHALL offer a way into the full-screen reader.

#### Scenario: An artifact renders inline

- **WHEN** the user opens the Artifacts tab of a ticket with a published artifact
- **THEN** the artifact's content renders inline in a sandboxed frame without leaving the ticket

#### Scenario: Choosing among artifacts

- **WHEN** a ticket has more than one published artifact
- **THEN** the tab lets the user switch which one is rendered inline

#### Scenario: A link-only artifact

- **WHEN** a ticket's artifact has no stored content
- **THEN** the tab shows it as a link-only row and does not mount an empty frame

### Requirement: The ticket page shows the live working state and activity line

While the ticket's worker is live (provisioning, active or running), the ticket page SHALL show the
working state and that worker's current activity line — the running command, the test in progress or
the last tool call — near the top of the page, without the user opening a run or its transcript. The
line SHALL update from the workspace event stream as new activity arrives. When the worker is live
but has no current activity, the page SHALL show the worker's last reported run summary as the line.
A ticket with no live worker SHALL show neither the working state nor an activity line for a worker.
A ticket whose worker is paused SHALL show the paused state and its reason instead.

The line and state SHALL be derived from the same workers read, runs and workspace event stream the
V2 Work screen uses, so the two surfaces cannot disagree.

#### Scenario: A running worker shows on the ticket page

- **WHEN** a ticket's worker is running with the current activity "Editing src/Ticket.tsx"
- **THEN** the page shows the working state and that activity line near the top, with no run opened

#### Scenario: The ticket page line updates live

- **WHEN** a worker.activity frame arrives for the ticket's worker
- **THEN** the page's activity line updates without a reload

#### Scenario: The ticket page shows no line without a live worker

- **WHEN** the ticket has no live worker
- **THEN** the page shows no working state and no activity line for a worker

#### Scenario: The ticket page shows a live state the stored status would hide

- **WHEN** a ticket's stored status is not itself a working status but a worker is live on it
- **THEN** the page shows the working state, as V1's board does for a live worker

### Requirement: A ticket whose approval is waiting on the weaver shows that state

When the ticket page renders a ticket whose status is `in_review` or `proposed` and whose live open
approval decision is of a review-carrying kind (`plan_approval`, `merge_approval`, `action_approval`)
whose review state is **not looked at yet**, the page SHALL show that the ticket is waiting on the
weaver's review, in the same terms the decision card uses, and SHALL NOT present the ticket as waiting
on the human alone. The page SHALL still render the decision card with its waiting state, and the
card's approving action SHALL remain withheld. The waiting state SHALL be derived from the ticket's
own open decisions rather than from the ticket's status alone.

Once the weaver marks the decision **looked at**, or the decision is answered, superseded, withdrawn
or expired, the page SHALL stop showing the waiting-on-review state and revert to its ordinary ticket
status. A ticket with no open review-carrying decision, and a ticket with no such decision at all,
SHALL show no waiting-on-review state.

#### Scenario: An in-review ticket with an unseen merge approval says it waits on the weaver

- **WHEN** an `in_review` ticket's live open `merge_approval` is **not looked at yet**
- **THEN** the ticket page shows that it is waiting on the weaver's review, and its merge card still
  shows the waiting state with its approving action withheld

#### Scenario: A clean mark clears the waiting state

- **WHEN** the weaver marks that merge approval **looked at** with no concerns
- **THEN** the ticket page no longer shows the waiting-on-review state

#### Scenario: An answered approval shows no waiting state

- **WHEN** the ticket's approval decision has been answered
- **THEN** the ticket page shows no waiting-on-review state for it

#### Scenario: A proposed ticket with a held plan reads the same way

- **WHEN** a `proposed` ticket's live open `plan_approval` is **not looked at yet**
- **THEN** the ticket page shows that it is waiting on the weaver's review
