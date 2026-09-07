## Why

VS-96 sat at `proposed` for over an hour with a complete, validated plan and nothing on captain's
Needs You. `putDocument()` supersedes a ticket's open `plan_approval` on **every** write to the
`plan` document key, not only the one case the code's own comment describes: a worker's revision
after a `revise` answer. The daemon itself writes `plan` once, harmlessly, right before it creates
the approval — but the worker skill's own closing convention ("leave durable progress… a `plan` or
`report` document") tells workers to write a `plan` document too, and any such write after the
ticket reaches `proposed` destroys the approval that is already open. Nothing errors, nothing is
logged where anyone would see it, and the ticket waits forever: `proposed` is not scanned for
liveness, because normally an open decision *is* the ticket's action path.

The `plan` key is doing two incompatible jobs: the daemon's own generated proposal.md + tasks.md
digest, which the approval's `target` points at, and a place for worker notes. Every `change` ticket
is exposed to this, invisibly, for as long as both jobs share the one key.

## What Changes

- **The `plan` document key becomes reserved to the daemon.** `ac_ticket_document_put` and
  `PUT /tickets/:id/documents/:key` refuse a write to `plan` from any external caller (human or
  agent) with a clear, immediate error naming `report` as the key for a worker's own notes. The
  daemon's own internal write — the proposal+tasks digest, right before it raises the approval — is
  unaffected, and still supersedes a stale open approval when it lands a new revision (a genuine
  `revise` round trip). No document is renamed, so every existing `plan` revision stays readable
  exactly as it is today; `ac_ticket_document_get` needs no change at all.
- **A ticket can no longer sit unnoticed in `proposed` with no open `plan_approval`, or in
  `in_review` (without `auto_merge`) with no open `merge_approval`.** The supervisor gains a scan,
  on the same cadence as the existing liveness scan, that finds any such ticket, raises a fresh
  approval for it (auto-answered immediately under YOLO, exactly as the original one would have
  been), and wakes the conductor naming the ticket and what was repaired. Whatever caused the gap —
  this bug, a future one, a decision withdrawn some other way — the ticket cannot stay silently
  stranded.
- The worker skill, its templates and the knowledge skill's ticket-vs-KB guidance stop telling
  workers to write a `plan` document; they now say `report`.

## Which fix, and why not the other

The ticket named two options: narrow the supersession to only a genuine revise round trip, or give
workers a document key of their own that is not `plan`. This change does the second, and does not
also narrow the supersession, because narrowing it would have kept `plan` a shared, ambiguous key —
`putDocument()` cannot tell a worker's incidental note from a real revision without new state to
track that distinction, and the next writer to reach for "a `plan` document" (a template, a worker,
a future feature) reopens the same hole. Making `plan` daemon-only removes the ambiguity outright:
the key means one thing, its supersession-on-write is exactly right for what it now exclusively
holds, and `report` (already the tool's own default document key) is what everyone else already
reaches for.

## Capabilities

### New Capabilities

- `human-decisions/approval-integrity`: the `plan` document key is reserved to the daemon; a ticket
  waiting on a `plan_approval` or `merge_approval` can never be left with none open; the supervisor
  repairs the gap and tells the conductor.

## Impact

- `packages/core/src/tickets/service.ts`: `putDocument` refuses `key: 'plan'` from any caller except
  its own internal `{ system: true }` write; a new `repairApprovals()` method. No separate change was
  needed in `packages/server/src/tools.ts` or `packages/server/src/routes/tickets.ts` — both already
  propagate a thrown `OcError` correctly, so the one guard in the service is already the choke point
  for every external caller (design.md explains why).
- `packages/core/src/api.ts`: `TicketsService.putDocument`'s new optional parameter;
  `TicketsService.repairApprovals()`.
- `packages/core/src/supervisor/index.ts`: a new scan calling it on the liveness cadence, waking the
  conductor when it repairs something.
- `templates/worker.AGENTS.md.tmpl`, `skills/agent-conductor-knowledge/SKILL.md`,
  `skills/agent-conductor-worker/references/tools.md`: stop naming `plan` as a worker-writable key.
- No database change, no migration, no config, no new dependency.
