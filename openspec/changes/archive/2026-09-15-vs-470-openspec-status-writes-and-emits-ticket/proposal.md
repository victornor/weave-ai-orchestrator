# Stop the OpenSpec status read writing and emitting on every check

Tracker change for [VS-470](weave://tickets/VS-470). A `task` ticket, so this change carries tasks
only — `skip_specs: true`. The diagnosis is a ticket `report` document, not a spec delta.

## Why

`OpenSpecService.statusFor()` (`packages/core/src/openspec/index.ts`) rebuilds a ticket's OpenSpec
state and then **always** runs `ctx.db.update('tickets', …, { openspecStateJson, updatedAt })` and
`ctx.events.emit('ticket.updated', …, { openspecState })`, whether or not the state changed. Its only
server caller is the ticket-detail read, `GET /tickets/:id`
(`packages/server/src/routes/tickets.ts:52`), whose response the web app fetches through `useTicket`.

`ticket.updated` invalidates `qk.ticket(ws, id)` (`packages/ui/src/api/events.ts:312`), so the read
that emitted the event is itself invalidated by it: **read → statusFor → emit → invalidate → read**.
On a running daemon that is a self-sustaining loop. Measured 2026-09-15: V Services VS-381 produced
7,980 identical `ticket.updated` events in 15 minutes (~9/s), and the VOFM workspace showed the same
shape on VOFM-77/84/69/57. Each iteration also bumped `updatedAt` and spawned four `openspec`
subprocesses (`status`, `list`, `instructions apply`, `validate`).

## What changes

- **A no-change read writes nothing and emits nothing.** `statusFor` compares the freshly computed
  status with the ticket's stored `openspec_state_json` using a key-order-independent deep
  comparison, and returns early — no `UPDATE`, no `updatedAt` bump, no `ticket.updated` — when they
  are equal. A real change is still one write and one emit, exactly as before.
- **The comparison ignores key order.** OpenSpec's own JSON output does not guarantee key order
  between invocations, so a plain `JSON.stringify` comparison would read a spurious change on every
  check and re-emit forever. The canonical form sorts object keys recursively; array order is kept,
  because it is semantic.

The caller is named in the delivery: the loop's engine is the unconditional emit, and skipping it
when the state is unchanged is what breaks the loop at its source.

## Out of scope

- Deleting or compacting existing `events` rows (explicitly out of scope in the ticket).
- Changing what `ticket.updated` invalidates in the web app, or the shape of the event payload.
- Any change to the OpenSpec CLI wrapper (`cli.ts`), `validateForProposed`, or `archiveAfterMerge`.
