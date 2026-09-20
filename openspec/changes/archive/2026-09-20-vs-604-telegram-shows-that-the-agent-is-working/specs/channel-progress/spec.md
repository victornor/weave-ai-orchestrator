# channel-progress Specification

## Purpose

Defines the optional channel-adapter progress hook and the daemon driver that turns a live agent run into
`start`/`update`/`end` progress on the channel threads bound to it, so an external channel can show that the
agent is working without the agent's words or the run's tool commands ever leaving the daemon.

## ADDED Requirements

### Requirement: Progress is an optional adapter capability

`ChannelAdapter` SHALL expose an optional `progress(p: ChannelProgress)` method, where `ChannelProgress` is
`{ threadExternalId: string; phase: 'start' | 'update' | 'end'; text?: string }`. A channel that does not
implement `progress` SHALL remain a valid adapter: the daemon SHALL start it, send through it and drive a
live run past it without calling it or failing.

#### Scenario: An adapter without progress stays valid

- **WHEN** a channel adapter defines no `progress` method and a run bound to one of its threads goes live
- **THEN** the daemon makes no `progress` call for it and the run and its outbound messages continue unchanged

#### Scenario: A channel that cannot show progress is named

- **WHEN** the plan lists the channels and whether each can show progress
- **THEN** the `web` channel (which has its own in-product live row) and the `cli` channel (a no-op transport) are recorded as not implementing it, rather than left silently different

### Requirement: The daemon drives progress from a live run

While a run is live, the daemon SHALL resolve the channel threads bound to the run's agent — and, when the
run is bound to a ticket, the channel threads bound to that ticket — whose channel implements `progress`. For
each such thread whose channel has progress it SHALL call `progress('start')` once, coalesced
`progress('update')` no more often than once every 2 s while the run continues, and `progress('end')` when
the run finishes. A run with no bound channel thread SHALL produce no progress calls.

#### Scenario: A live weaver turn shows progress on its Telegram thread

- **WHEN** the weaver has a live run and a Telegram thread is bound to the weaver's agent
- **THEN** that thread receives `start` once, at most one `update` per 2 s, and `end` when the run finishes

#### Scenario: A run with no bound thread does nothing

- **WHEN** a run is live for an agent with no channel thread bound to it or to its ticket
- **THEN** no channel receives any progress call

#### Scenario: A ticket-bound channel thread follows the ticket's worker

- **WHEN** a human has switched a Telegram thread to a ticket and the worker on that ticket has a live run
- **THEN** the thread receives the worker's progress, not only the conductor's

### Requirement: Progress text is generic state only

The text the daemon sends to an external channel SHALL be built from the live state's state word, the seconds
in that state, the tool-call count and the whole-steps-only notice. It SHALL NOT contain a tool name, a
command, a file path, a tool argument or any streamed model text, because an external channel publishes and
may cache what it receives. Streamed text and tool details SHALL stay in the in-product run view.

#### Scenario: A running tool is stated generically

- **WHEN** a run has an open `bash` tool call and the daemon sends a progress update
- **THEN** the text reads `Working · <n> s · <m> tool calls` and contains no part of the command or its target

#### Scenario: Waiting on the model is stated generically

- **WHEN** the last event was a completed tool and the model is generating the next step
- **THEN** the text reads `Waiting for the model · <n> s` with no model text

### Requirement: A progress failure never fails a turn

When an adapter's `progress` call throws or rejects, the daemon SHALL log the failure and continue. The run,
its persisted events and its outbound message delivery SHALL be unaffected by any progress failure.

#### Scenario: The channel rejects a progress call

- **WHEN** `progress` throws for a live run
- **THEN** the run continues to completion and the run's final outbound message is still delivered
