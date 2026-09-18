## MODIFIED Requirements

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
