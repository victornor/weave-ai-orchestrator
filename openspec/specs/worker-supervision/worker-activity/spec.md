# worker-supervision/worker-activity Specification

## Purpose
Lets the daemon say, on a read and on the workspace stream the board already consumes, what a live
worker is doing this moment and the tally of its most recent test run, derived from the worker's own
run events without opening a stream per card.

## Requirements

### Requirement: The daemon derives a live activity line for a worker from its run events

For a worker whose run is in progress, the daemon SHALL derive a single-line activity summary from
that run's most recent relevant event: a short human label naming what the worker is doing, and the
time that activity began. The label SHALL be produced from the event's normalized shape, not from
runtime-specific text, and SHALL update as further events arrive.

The activity line SHALL be present only while the worker has a run in progress. A worker that is
between turns, waiting on a decision, merging or delivering SHALL carry no activity line: those
states are already the ticket's and the worker's own, and the board SHALL use them rather than a
tool-verb line.

#### Scenario: The worker is editing a file

- **WHEN** a worker's current run records a tool call that edits or writes a file
- **THEN** its activity line names that activity and the file

#### Scenario: The worker is running a command

- **WHEN** a worker's current run records a shell command that is not a test run
- **THEN** its activity line names running a command

#### Scenario: The activity time begins when the activity changes

- **WHEN** a worker's activity line changes from one activity to another
- **THEN** the time the line carries is the time the new activity began, not the start of the run

#### Scenario: No line between turns

- **WHEN** a worker has no run in progress
- **THEN** it carries no activity line

### Requirement: Tool calls map to short human verbs across every runtime

The daemon SHALL map a worker's latest tool activity to one of a small closed set of human labels,
keyed off the normalized event shape each runtime adapter emits and the tool names each runtime uses:
editing or writing a file (`Editing <file>` / `Writing <file>`), reading or searching code
(`Reading code`), running a shell command that runs tests (`Running tests`), any other shell command
(`Running a command`), fetching or searching the web (`Researching`), and a generic `Working` for any
tool or event the mapping does not recognise. The mapping SHALL recognise both a tool call event
carrying a tool name and a runtime that emits a file change or command execution without one
(for example Codex's `file_change` and `command_execution` items).

A tool or event the mapping does not recognise SHALL fall back to `Working`; it SHALL NOT produce an
empty line, a raw tool name or a broken card.

#### Scenario: A Claude Edit names the file

- **WHEN** a worker running Claude records an `Edit` tool call for `src/Board.tsx`
- **THEN** its activity line reads as editing `src/Board.tsx`

#### Scenario: A read or search reads as reading code

- **WHEN** a worker records a read, grep or glob tool call
- **THEN** its activity line reads as reading code, without a file name

#### Scenario: A shell command that runs tests reads as running tests

- **WHEN** a worker records a shell command whose command string runs one of the common test runners
  or a package's test script
- **THEN** its activity line reads as running tests

#### Scenario: Another shell command reads as running a command

- **WHEN** a worker records a shell command that is not a test run
- **THEN** its activity line reads as running a command

#### Scenario: A web fetch or search reads as researching

- **WHEN** a worker records a web fetch or web search tool call
- **THEN** its activity line reads as researching

#### Scenario: An unknown tool falls back to working

- **WHEN** a worker records a tool the mapping does not recognise
- **THEN** its activity line reads `Working` and the card is not empty or broken

#### Scenario: Every runtime's shape is recognised

- **WHEN** a worker records an edit, a read, a shell command or a web action through any bundled
  runtime's normalized events (Claude, OpenCode, Codex, Gemini or Cursor)
- **THEN** its activity line is the same human label that runtime's activity would produce through any
  other runtime

### Requirement: The daemon parses the latest test tally from the worker's most recent test command

When a worker runs a test command, the daemon SHALL parse a passed/total tally from that command's
output, supporting the common runners generally: vitest, jest, bun test, `node --test`, pytest,
`go test`, cargo test and `dotnet test`. The tally SHALL reflect failures (a run with failures SHALL
report fewer passed than total). A command whose output carries no recognisable summary SHALL yield no
tally, and the daemon SHALL NOT infer, estimate or round a number it did not read.

The tally SHALL be read from the command's output before that output is size-bounded, so a long run's
summary line is not lost to truncation.

#### Scenario: Vitest's tally

- **WHEN** a vitest run's output carries its summary of passed and total tests
- **THEN** the tally is that passed count over that total

#### Scenario: A failing run

- **WHEN** a runner's summary reports some tests failing
- **THEN** the tally's passed count is less than its total

#### Scenario: Each supported runner

- **WHEN** the output of jest, bun test, `node --test`, pytest, `go test`, cargo test or `dotnet test`
  carries that runner's own summary
- **THEN** the daemon reads the same passed/total tally from it

#### Scenario: No summary

- **WHEN** a command's output carries no recognisable test summary
- **THEN** no tally is produced and nothing is guessed in its place

### Requirement: The last parsed tally survives the turn ending until a newer one replaces it

After the worker's turn ends, the last test tally the daemon parsed SHALL remain available for that
worker and SHALL continue to be reported on the worker read and shown on the board, until a newer test
command produces a tally that replaces it. A later turn that runs no tests SHALL NOT clear it.

#### Scenario: The tally outlives the turn

- **WHEN** a worker's turn runs tests and ends
- **THEN** its test tally is still reported afterwards

#### Scenario: A newer run replaces the tally

- **WHEN** the worker later runs tests and the daemon parses a new tally
- **THEN** the reported tally is the new one

#### Scenario: A testless turn does not clear the tally

- **WHEN** the worker takes a further turn that runs no tests
- **THEN** the last parsed tally is still reported

### Requirement: The activity summary is exposed on the workers read and pushed cheaply

The daemon SHALL include each worker's current activity line and last test tally on the workers read
(the workers list and a worker's own read), so a client that has just loaded is already correct
without waiting for a stream frame.

While a worker's activity or tally changes, the daemon SHALL push the updated summary to the board on
the workspace event stream the board already consumes, throttled so that a busy worker cannot make
the board re-render many times a second. The daemon SHALL NOT require, and SHALL NOT open, a
run-event stream per board card. A client that misses a frame SHALL still converge on the correct
summary from the next read or frame.

#### Scenario: A fresh read is already correct

- **WHEN** a client reads the workers while a worker is running
- **THEN** the response carries that worker's current activity line and its last test tally

#### Scenario: A change is pushed

- **WHEN** a live worker's activity line changes
- **THEN** the change is pushed on the workspace stream without the client opening a per-card stream

#### Scenario: Updates are throttled

- **WHEN** a worker emits many events within the throttle window
- **THEN** the board receives at most one activity update for that worker in that window

#### Scenario: No per-card stream

- **WHEN** the board shows many working cards
- **THEN** it holds no run-event stream per card

### Requirement: The workers and tickets reads carry the persisted stalled fact

The workers read (the workers list and a worker's own read) and the tickets read SHALL carry, for a
worker in an active stall/recovery cycle (per the stalled-worker-detection capability) and for its
ticket, the fact that it is stalled — distinct from every other status a worker or ticket can be in,
including an ordinary working status and a status where the worker is correctly waiting on someone
else. A worker or ticket not in an active stall/recovery cycle SHALL NOT carry this fact.

While a worker enters or leaves an active stall/recovery cycle, the daemon SHALL push the change to
the board on the workspace event stream the board already consumes, on the same terms as its other
pushed status changes.

#### Scenario: A stalled worker's read carries the fact

- **WHEN** a client reads a worker that is in an active stall/recovery cycle
- **THEN** the response marks that worker as stalled, distinguishably from `active`

#### Scenario: A stalled ticket's read carries the fact

- **WHEN** a client reads a ticket whose assigned worker is in an active stall/recovery cycle
- **THEN** the response marks that ticket as stalled, distinguishably from its ordinary working status

#### Scenario: A working worker's read does not carry the fact

- **WHEN** a client reads a worker with a run in progress, however long that run has been running
- **THEN** the response does not mark that worker as stalled

#### Scenario: A worker correctly waiting is not marked stalled

- **WHEN** a client reads a worker whose ticket has an open decision, a queued action-path wakeup, or
  a scheduled future self-wake
- **THEN** the response does not mark that worker as stalled

#### Scenario: The change is pushed when a worker becomes stalled

- **WHEN** a worker enters an active stall/recovery cycle
- **THEN** the board receives the updated status on the workspace stream without a client having to
  poll for it

#### Scenario: The change is pushed when a worker recovers

- **WHEN** a worker in an active stall/recovery cycle is found to have made observable progress
- **THEN** the board receives the cleared status on the workspace stream
