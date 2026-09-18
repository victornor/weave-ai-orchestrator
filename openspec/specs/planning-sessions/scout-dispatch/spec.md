# planning-sessions/scout-dispatch Specification

## Purpose
Lets a scout draft run as a real ticket before its plan is submitted — from the plan's tab, by
captain, or from the planning conversation, by the planning agent that drafted it — with its report
routed to that planning agent instead of to the weaver, so a plan's own scouting can inform the plan
while it is still being written.

## Requirements

### Requirement: Only a scout draft can be dispatched, deliberately, one at a time

Both captain and the plan's own planning agent SHALL be able to dispatch a draft, only when that
draft's `kind` is `scout`, that draft belongs to a plan that is still `drafting`, and that draft has
not already been dispatched or otherwise turned into a ticket. An attempt against any other draft, a
draft belonging to a different plan than named (or, for the planning agent, any plan other than its
own session's), or a draft already turned into a ticket SHALL be refused, and SHALL NOT create a
ticket. Dispatch SHALL NOT happen as a side effect of any other action — not when the planning agent
adds a scout draft, and not for any draft neither party has explicitly dispatched.

#### Scenario: Dispatching a scout draft succeeds

- **WHEN** captain, or the plan's own planning agent, dispatches a `scout` draft that belongs to a
  `drafting` plan and has not yet been dispatched
- **THEN** a real ticket is created for that draft

#### Scenario: A change, task, or operational draft cannot be dispatched

- **WHEN** captain or the planning agent attempts to dispatch a draft whose `kind` is `change`, `task`,
  or `operational`
- **THEN** the attempt is refused and no ticket is created

#### Scenario: A draft cannot be dispatched under another plan's id

- **WHEN** a dispatch names a plan id the target draft does not belong to, or the planning agent
  attempts to dispatch a draft from a plan other than its own session's
- **THEN** the attempt is refused and no ticket is created

#### Scenario: An already-dispatched draft cannot be dispatched again

- **WHEN** captain or the planning agent attempts to dispatch a draft that already has a linked ticket
- **THEN** the attempt is refused and no second ticket is created

#### Scenario: A draft in a submitted or discarded plan cannot be dispatched

- **WHEN** captain or the planning agent attempts to dispatch a draft whose plan is `submitted` or
  `discarded`
- **THEN** the attempt is refused and no ticket is created

#### Scenario: Adding a draft never dispatches it

- **WHEN** the planning agent adds a `scout` draft to its plan
- **THEN** no ticket is created for it — dispatching is a separate, explicit action, from either party

### Requirement: A dispatched scout is an ordinary ticket in every way but who is told it finished

The ticket created by dispatching a scout draft SHALL carry that draft's title, description, priority
and target role, SHALL be visible on the project's work page like any other ticket, SHALL run a real
worker and a real run, and SHALL deliver its report the same way any scout ticket does. Nothing about
how it is supervised or retried SHALL depend on who dispatched it early, or on that rather than it
being filed at plan submission. Its display SHALL show its plan origin — the plan it came from, and
whether it was created by an early dispatch or at plan submission — as `web-v2/work` and
`web-v2/ticket-page` require.

#### Scenario: A dispatched scout appears on the work page while it runs

- **WHEN** a scout draft has been dispatched and its ticket is not yet finished
- **THEN** that ticket is visible on the project's work page with a real worker and a real run, the
  same as a scout ticket the weaver filed

#### Scenario: A dispatched scout delivers a report document the same way any scout does

- **WHEN** a dispatched scout's worker finishes its investigation
- **THEN** it delivers a report document to its ticket exactly as it would for any other scout ticket

#### Scenario: The work page shows an early dispatch as such

- **WHEN** a dispatched scout's ticket and a ticket created at the same plan's submission both appear
  on the work page
- **THEN** each shows the plan it came from and they are distinguishable from each other

### Requirement: A dispatched scout's report reaches the planning agent while its plan is still drafting

While the plan a dispatched scout's draft belongs to is still `drafting`, the system SHALL, when that
scout's ticket reaches a terminal status, ensure a live planning agent for that plan and give it the
report, without waking the weaver. The plan's conversation SHALL reflect that the report has arrived by
the planning agent's next turn.

#### Scenario: A finished dispatched scout wakes its plan's planner, not the weaver

- **WHEN** a dispatched scout's ticket reaches `done` while its plan is still `drafting`
- **THEN** the plan's planning agent is woken with the report, and the weaver receives no wake as a
  result

#### Scenario: An idled-out planner is re-ensured to receive the report

- **WHEN** a dispatched scout's ticket finishes, its plan is still `drafting`, and that plan's planning
  agent had previously been retired for inactivity
- **THEN** a planning agent is ensured again for that plan before the report is delivered to it

#### Scenario: The planner can read the report through the plan it already reads

- **WHEN** the planning agent looks up its own plan after a dispatched scout's ticket has finished
- **THEN** it can read that scout's report without any tool beyond the ones it already uses to read its
  own plan

### Requirement: The weaver is never woken by a scout dispatch, its run, or its completion

Dispatching a scout draft, any progress its ticket makes while running, and its ticket reaching a
terminal status SHALL NOT enqueue a wake to the weaver. This holds regardless of whether the scout
succeeds, fails, or is later found stalled by the same detection every other ticket is subject to.

#### Scenario: No weaver wake at any point in a dispatched scout's lifecycle

- **WHEN** a scout draft is dispatched, its ticket runs to completion, and its report is delivered to
  the planning agent
- **THEN** at no point in that sequence is the weaver woken

#### Scenario: A genuinely stalled dispatched scout still surfaces through the ordinary safety net

- **WHEN** a dispatched scout's ticket meets the workspace's existing stalled-worker detection, the
  same as any other ticket would
- **THEN** it is flagged and surfaces through the same fault-surfacing path every stalled ticket
  already uses, whether or not its plan is still drafting

### Requirement: A dispatched scout is never re-filed when its plan is later submitted

A draft that was dispatched before its plan was submitted SHALL be recognized, at submission-time
ticket creation, as already having a ticket, and SHALL NOT have a second ticket created for it.

#### Scenario: Submitting a plan does not duplicate an already-dispatched scout's ticket

- **WHEN** a plan containing a dispatched scout draft is submitted
- **THEN** ticket creation for that submission does not create a second ticket for the already-
  dispatched draft

#### Scenario: A dependency on an already-dispatched draft still resolves correctly

- **WHEN** a submitted plan has a draft that depends on an already-dispatched scout draft
- **THEN** the dependent draft's created ticket is blocked by the scout's already-existing ticket,
  rather than a newly created one

### Requirement: A dispatched scout still running when its plan is discarded or submitted is never cancelled

The system SHALL NOT cancel, pause, or otherwise interrupt a dispatched scout's ticket because its
plan was discarded or submitted while the scout was still running. Once the plan is no longer
`drafting`, the ticket continues, and its eventual completion no longer attempts to reach a planning
agent — it is left to the same supervision and reporting behavior any standalone ticket already has.

#### Scenario: Discarding a plan leaves its already-dispatched, still-running scout alone

- **WHEN** captain discards a plan that has a dispatched scout draft whose ticket has not yet finished
- **THEN** that ticket keeps running, uninterrupted, and remains visible on the work page

#### Scenario: A scout that finishes after its plan left drafting falls back to ordinary behavior

- **WHEN** a dispatched scout's ticket reaches a terminal status after its plan has become `submitted`
  or `discarded`
- **THEN** no attempt is made to deliver its report to a planning agent, and the ticket's completion is
  handled exactly as it would be for any standalone ticket
