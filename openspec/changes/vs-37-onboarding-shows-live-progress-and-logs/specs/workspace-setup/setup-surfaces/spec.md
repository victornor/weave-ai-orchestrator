## Purpose

Defines what the human sees while a workspace is being set up: what the web app's onboarding flow and
`conductor project add` show while a step runs, when one fails, and after the page was reloaded. The
contract is that a step which takes minutes never looks the same as a step that is stuck.

## ADDED Requirements

### Requirement: Onboarding shows every step's state and elapsed time

While a workspace is being created, the onboarding flow SHALL show each planned step with its state
and, from the moment it starts, the time it has been running. The elapsed time SHALL keep advancing
while the step runs and SHALL be retained — as the time the step took — once it has ended.

#### Scenario: A running step is visibly progressing

- **WHEN** a step has been running for some time
- **THEN** its elapsed time is shown and keeps advancing

#### Scenario: The duration survives completion

- **WHEN** a step ends
- **THEN** the time it took stays on screen

### Requirement: Onboarding shows the active sub-step and live output of a step backed by a job

A step performed by a job SHALL show which of the job's sub-steps is currently running, the sub-steps
already finished, and a live tail of the output lines the job has produced. New lines SHALL appear
while the sub-step is still running, not only once it has finished.

A step not backed by a job — one that completes in a single request — SHALL show its state and
elapsed time only.

#### Scenario: A four-minute project add is visibly working

- **WHEN** the step adding a project is on its clone sub-step and the clone is producing output
- **THEN** the view names the clone sub-step as active and shows its most recent output lines

#### Scenario: Sub-steps advance

- **WHEN** the job moves from one sub-step to the next
- **THEN** the finished sub-step is shown as finished and the next one as active

### Requirement: A failed step shows what failed and offers a retry

A step that fails SHALL show which sub-step failed and the last output lines before the failure,
rather than only a failed state, and SHALL offer a retry. Retrying SHALL re-run the failed step and
return the view to showing its live progress, without restarting the steps that already succeeded.

#### Scenario: A failure is diagnosable in place

- **WHEN** the step adding a project fails while adopting OpenSpec
- **THEN** the view names that sub-step as the failure and shows the last output lines before it failed

#### Scenario: Retry resumes the same flow

- **WHEN** the human retries a failed step
- **THEN** that step runs again with live progress, and the steps that already succeeded are not repeated

### Requirement: Reloading mid-step resumes the live view

If the onboarding page is reloaded while a step is running, the flow SHALL come back showing the same
steps and re-attach to the job still running, resuming the live sub-step and output display, instead
of returning to the start of onboarding or showing an unknown state.

If the operation finished while the page was away, the flow SHALL come back showing its outcome.

#### Scenario: Reload while the project is cloning

- **WHEN** the onboarding page is reloaded while the project-add step is running
- **THEN** the flow shows the same steps, re-attaches to the running job, and continues showing its sub-step and output live

#### Scenario: Reload after it finished

- **WHEN** the onboarding page is reloaded after the last step finished
- **THEN** the flow shows the finished steps and the way on into the new workspace

### Requirement: `conductor project add` shows the same progress

`conductor project add` SHALL report the same progress as the web app: each sub-step as it starts, the
output lines it produces while it runs, and a final summary of the project that was added. On failure
it SHALL name the failing sub-step, show its last output lines, exit non-zero, and say how to retry.

In JSON output mode the command SHALL still print exactly one JSON document describing the finished
project, with no progress interleaved.

#### Scenario: Watching an add from the terminal

- **WHEN** `conductor project add` is run against a repository that takes minutes to clone
- **THEN** the sub-steps and the clone's output appear as they happen, ending in the usual summary

#### Scenario: A failure at the terminal

- **WHEN** the add fails
- **THEN** the failing sub-step and its last output lines are shown, the command exits non-zero, and the retry is named

#### Scenario: JSON output stays machine-readable

- **WHEN** `conductor project add` is run in JSON output mode
- **THEN** exactly one JSON document describing the finished project is printed
