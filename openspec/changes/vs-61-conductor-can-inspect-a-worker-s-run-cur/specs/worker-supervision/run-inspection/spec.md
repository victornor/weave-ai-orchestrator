## Purpose

Lets the conductor see what a worker's run is actually doing — the phase it is in, how long it has
been there, the state of the worker itself and a bounded, redacted transcript of its recent activity
— so that supervision decisions are made on evidence rather than on silence, and so that the
conductor is not left with relaunching as its only move.

## ADDED Requirements

### Requirement: The conductor can inspect the run behind a ticket, a worker or a run id

The system SHALL let the conductor inspect a run by naming a ticket, a worker or a run. Naming a
ticket or a worker SHALL resolve to the run currently executing for it, and to its most recent
finished run when none is executing. Naming a run SHALL inspect that run.

The inspection SHALL report, for the resolved run: its identifier, its status, which turn it is, the
runtime and model it is using, when it started, how long it has been running or how long it ran, its
liveness once the run has been assessed, and the error family and code when it failed.

The inspection SHALL report the state of the worker that owns the run: its status, the reason it is
paused when it is paused, its error text when it is in error, the ticket it is working and the role
it was spawned from.

A reference that resolves to nothing SHALL be refused as not found, and a reference that resolves to
an entity in another workspace SHALL be refused as not found. Nothing about the run or the worker
SHALL be changed by inspecting it.

#### Scenario: Inspecting the ticket of a worker that is mid-run

- **WHEN** the conductor inspects a ticket whose worker is executing a run
- **THEN** it receives that run's identifier, status, turn, runtime, model, start time and elapsed
  time, together with the worker's status and its ticket

#### Scenario: Inspecting a ticket whose worker is between turns

- **WHEN** the conductor inspects a ticket whose worker has no run executing
- **THEN** it receives the worker's most recent finished run, with the run's outcome, its liveness
  and how long it ran

#### Scenario: Inspecting by worker id and by run id

- **WHEN** the conductor inspects using a worker id, and again using a run id
- **THEN** both resolve to the same run as the equivalent ticket reference does

#### Scenario: An unknown reference

- **WHEN** the conductor inspects a reference that matches no ticket, worker or run in its workspace
- **THEN** the call fails as not found and nothing is changed

### Requirement: The inspection names the phase the run is in and how long it has been there

The system SHALL report which phase of the run is currently under way, chosen from the phases the run
engine defines, together with the phases that have already completed and how long each of them took.

A run that has not yet reported any completed phase SHALL be reported as being in the first phase. A
run that has finished SHALL report no current phase.

#### Scenario: A run in the middle of its turn

- **WHEN** the conductor inspects a run that has completed the phases up to and including building
  its prompt
- **THEN** the current phase is reported as the turn, and the completed phases are listed with their
  durations

#### Scenario: A run that has finished

- **WHEN** the conductor inspects a run that has finished
- **THEN** no current phase is reported, and the completed phases are listed with their durations

### Requirement: The inspection returns a compact, redacted transcript of the run

The inspection SHALL include a transcript of the run's recorded events, rendered compactly: assistant
text truncated per entry, a tool call and its result folded into a single line naming the tool, the
one thing it acted on and its outcome, tool output truncated, and phase markers, run lifecycle lines
and errors kept in full. Each entry SHALL carry the sequence number and timestamp of the event it
came from, so an entry can be located in the run.

Every string that reaches the conductor SHALL be redacted with the same rules the system applies to
anything that reaches a screen. The inspection SHALL NOT expose anything the run engine did not
already record.

#### Scenario: A transcript of a working run

- **WHEN** the conductor inspects a run whose recorded events include assistant text, a tool call
  with its result, a phase marker and an error
- **THEN** the transcript folds the call and its result into one line, keeps the phase marker and
  the error in full, and carries a sequence number and a timestamp on every entry

#### Scenario: A secret in a tool result

- **WHEN** a recorded event carries a value the redaction rules recognise as a secret
- **THEN** that value does not appear in the transcript the conductor receives

### Requirement: The transcript is bounded and says where to resume

By default the inspection SHALL return the newest entries of the run, up to a default number of
events with a hard maximum the caller cannot exceed. When given a sequence cursor, the inspection
SHALL instead return the entries after that sequence. When asked for the whole run, it SHALL start
from the beginning of the run.

The total response SHALL NOT exceed a fixed size limit, regardless of the number of events requested.
Whenever entries are left out — because the event limit was reached, because the size limit was
reached, or because older entries were dropped to fit — the response SHALL say so explicitly and
SHALL name the sequence number to resume from, so that the conductor can page through the run without
guessing. The response SHALL also report the total number of events recorded for the run and the
sequence range it returned.

#### Scenario: A run longer than the default window

- **WHEN** the conductor inspects a run with far more recorded events than the default limit
- **THEN** it receives the newest entries, the response is marked as truncated, and it names the
  sequence to resume from and the total number of events in the run

#### Scenario: Paging with a cursor

- **WHEN** the conductor inspects the same run again passing the sequence it was told to resume from
- **THEN** it receives the entries after that sequence and no earlier ones

#### Scenario: A single runaway event

- **WHEN** a run contains entries whose combined size exceeds the response size limit
- **THEN** the response stays within the limit, is marked as truncated, and still names a sequence
  to resume from

#### Scenario: Asking for more than the maximum

- **WHEN** the conductor asks for more events than the maximum the system allows
- **THEN** the request is refused as invalid rather than answered with an unbounded response

### Requirement: The conductor can list the recent runs behind a ticket or a worker

The system SHALL let the conductor list the recent runs for a ticket or a worker, newest first, each
with its identifier, status, turn, liveness, start time, duration, error family and code when it
failed, and the run it was a retry of when it was one. The number of runs returned SHALL be bounded
by a default and a maximum.

#### Scenario: A worker that has retried

- **WHEN** the conductor lists the runs for a ticket whose worker failed and was retried
- **THEN** it receives the runs newest first, each with its outcome and duration, and each retry
  identifies the run it retried

#### Scenario: A ticket that has never run

- **WHEN** the conductor lists the runs for a ticket no worker has ever run
- **THEN** it receives an empty list rather than an error

### Requirement: Only the conductor may inspect a run

Inspecting a run and listing runs SHALL be available to the conductor and SHALL be refused to a
worker, so that no worker can read another worker's transcript. The refusal SHALL be a forbidden
error naming the tool, not a not-found error and not an empty result.

The conductor SHALL be able to inspect its own runs by the same means.

#### Scenario: A worker tries to inspect a run

- **WHEN** a worker calls the run inspection tool
- **THEN** the call is refused as forbidden and no transcript is returned

#### Scenario: The run inspection tools are not offered to workers

- **WHEN** a worker lists the tools available to it
- **THEN** neither the run inspection tool nor the run listing tool is among them

#### Scenario: The conductor inspects its own run

- **WHEN** the conductor inspects a run of its own
- **THEN** it receives that run's phase, elapsed time and transcript like any other
