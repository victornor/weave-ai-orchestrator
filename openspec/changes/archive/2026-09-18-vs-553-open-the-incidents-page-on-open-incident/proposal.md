## Why

Two screens currently tell the human the opposite of the truth. The V2 Incidents page opens on
*All*, so a fully-resolved incident list looks like an outstanding pile while the nav badge — which
counts only open incidents — says zero. And a persistent session's transcript attributes both the
human's message and the agent's reply the same way, so a conversation with a role reads as if the
human were talking to themselves.

## What Changes

- The V2 Incidents page opens with the **Open** chip active rather than **All**, so the default view
  agrees with the nav badge's open-incident count. All and Resolved keep working unchanged.
- The empty state the page shows when the active filter matches nothing SHALL read as "nothing is
  wrong" when the filter is Open (the state it will be in almost all the time), and as "nothing here"
  only where that is literally true.
- A persistent session's transcript attributes each message by its author, not by direction alone:
  the human's messages stay `you`, the session agent's messages are labelled with the agent's name
  (its role's name — "Full-stack Engineer", not `session` or `assistant`), and any other author that
  can reach the thread — a system notice, or a message the weaver sent — is named for what it is
  instead of falling back to `you`.

## Capabilities

### New Capabilities
<!-- none: both changes modify existing capabilities -->

### Modified Capabilities

- `web-v2/incidents`: the page's initial filter is Open, and its empty state distinguishes "no open
  incidents" from "nothing matches this filter".
- `persistent-sessions`: the session's conversation names its authors — the human as `you`, the
  session agent by its role name, and every other author (system, weaver) by its own name.

## Impact

- **UI**: `packages/ui/src/v2/IncidentsPage.tsx` (default filter and empty-state branch);
  `packages/ui/src/v2/WorkerPage.tsx` (`SessionThreadFeed` attribution, fed the session's role
  name). Tests: `packages/ui/src/test/v2incidents*` and `packages/ui/src/test/v2worker.test.tsx`.
- **Server**: `GET /workers/:id` gains the worker's `role` (already declared on the client's
  `WorkerDetail`, currently always null) so the session transcript can name the role. Route test in
  `packages/server/test/workers.test.ts`.
- **No** schema, migration, API-contract change beyond that additive response field, and no change to
  the incidents route or its data.
