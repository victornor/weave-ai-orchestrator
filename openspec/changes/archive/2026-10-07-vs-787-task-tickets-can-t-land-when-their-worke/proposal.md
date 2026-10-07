## Why

`weave_ticket_create` binds an `openspecChangeName` to every ticket, `task` kind included. A task is usually a small fix with no spec delta, so its worker never creates the change. Landing then fails with `openspec_archive_blocked: ... no such change exists` and the worker is stuck until someone tells it to create a dummy change with `skip_specs: true` (VS-785 on 2026-10-07). Projects already carry a convention note for that workaround.

## What Changes

- Landing a `task` ticket whose bound change exists neither under `openspec/changes/` nor in the archive treats it as "nothing to archive": the merge proceeds and the ticket gets a status comment saying no OpenSpec change existed and the archive was skipped.
- A `task` ticket whose change does exist archives exactly as before.
- A `change` ticket with a missing change keeps failing with `openspec_archive_blocked`.
- The binding itself is unchanged: tickets keep their `openspecChangeName`.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `ticket-delivery/archive-before-merge`: a missing change no longer blocks landing of a `task` ticket.

## Impact

`packages/core/src/tickets/archive-before-merge.ts` (new opt and callback on `attemptArchiveThenMerge`) and `packages/core/src/tickets/service.ts` (`mergeDone` passes the ticket kind and records the comment). Tests in `archive-before-merge.test.ts` and the tickets service tests.
