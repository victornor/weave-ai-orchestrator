# Design — VS-470

## Where the storm comes from

```
GET /tickets/:id            (server/src/routes/tickets.ts:52)
  └─ openspec.statusFor     (core/src/openspec/index.ts:102)
       ├─ db.update tickets  (line 126)
       └─ emit ticket.updated (line 127)
            └─ invalidateFor: inv(qk.ticket(ws, id))   (ui/src/api/events.ts:312)
                 └─ useTicket refetch → GET /tickets/:id → statusFor → …
```

`statusFor` has exactly two callers: the ticket-detail GET route above and the `weave_openspec_status`
MCP tool (`server/src/tools.ts:668`). Nothing else in the daemon calls it, so the loop is not a
server-side timer or the merge monitor — it is the read path re-asking on the `ticket.updated` it
caused itself.

## Why the comparison must be canonical

The status is a plain JSON value. The stored copy is round-tripped through SQLite
(`openspec_state_json`), and the fresh copy is built from `openspec`'s parsed stdout. OpenSpec does
not guarantee object key order across runs, so `JSON.stringify(stored) === JSON.stringify(fresh)`
would report a difference on a stable state and re-emit every time — replacing the storm with a
smaller storm. `canonicalJson()` sorts object keys recursively before stringifying. Arrays keep
their order: `artifacts` and `validation.issues` are ordered lists, and reordering them is a real,
visible change.

`undefined` cannot appear in a parsed JSON status, but a defensive branch keeps `canonicalJson` total
for any input a test hands it.

## Why the fix lives in `statusFor`, not the route

The route needs the fresh state for its response and the persisted state for the worker relaunch
brief (`core/src/workers/index.ts:215`) and the changelog. Skipping only the *write* on a read and
keeping the emit, or vice versa, would either leave the cache stale while the UI still loops, or
update the cache without telling anyone. Skipping both together, only when nothing changed, keeps
the existing contract — one write and one emit per real change — and removes the loop's fuel.
