## Context

See `proposal.md` — Why. Two facts from reading the current code shape the approach.

**Part 1.** `IncidentsPage.tsx` holds `useState<IncidentFilter>('all')` and filters the fetched list
client-side. The nav badge does not read the page at all: `useV2Counts` computes
`items.filter((i) => i.resolvedAt === null).length`, the same predicate the page's `open` filter
uses (`packages/ui/src/v2/V2Page.tsx:90`). The only disagreement is which chip is active on arrival.

**Part 2.** The session transcript is `SessionThreadFeed` in
`packages/ui/src/v2/WorkerPage.tsx:54-71`. It labels each message with a single ternary on
`m.direction` — `'outbound' ? 'session' : 'you'` — and uses the same ternary for alignment and
background. `ThreadMessage` also carries `authorKind` (`'human' | 'agent' | 'system'`) and `authorId`,
and the db layer maps those columns to camelCase (`packages/db/src/db.ts:65,70`), so the UI already
receives them. The rendered evidence that exposed this (VS-526's harness, `/tmp/opencode/vs526-shots`)
seeded messages with `authorKind` but no `direction`; with `direction` undefined every message fell to
`you`. The real defect is broader than the harness: even with direction present, an agent's reply
reads `session` (a generic word, not the role's name), a system notice reads `session`, and anything
whose direction is missing reads `you`.

The worker detail client type `WorkerDetail.role` and its parser already expect a `role`
(`packages/ui/src/api/hooks.ts:69`), but `GET /workers/:id` never sends one
(`packages/server/src/routes/workers.ts`), so it is always null today.

## Goals / Non-Goals

**Goals**
- The Incidents page's first view is open incidents, and its empty state reads the way the badge does.
- A session transcript attributes every message to its real author, naming the agent by its role.
- Both fixes are verifiable by unit test and by rendered capture in light and dark.

**Non-Goals**
- No change to the incidents route, its data, or the badge's own predicate — only the page's default
  and wording.
- No new message kinds, no change to how a session's replies are stored or delivered.
- No rework of the shared `ChatMessage`/`ChatConversation` (the weaver's chat), which has its own
  layout and does not print author lines.

## Decisions

**D1. Part 1 is a one-word default change plus a filter-aware empty state.** The initial state
becomes `'open'`. The empty branch chooses by the active filter: `all`/zero incidents keeps the
existing "No incidents." wording, `open` gets a "nothing wrong" message, `resolved` gets "nothing
resolved yet". Alternative considered: derive the default from the nav badge's count and reset when it
changes — rejected as stateful and surprising; a static default already agrees with the badge because
both use `resolvedAt === null`.

**D2. Part 2 attributes by `authorKind`, not `direction`.** The label resolver is a pure function over
`(authorKind, authorId, sessionAgentId, roleName)`:

| author | label |
|---|---|
| `human` | `you` |
| `agent`, `authorId` is the session agent | the role's name |
| `agent`, any other/unknown author | `Weaver` |
| `system` | `System` |
| anything else | its `authorKind`, never `you` |

`direction` stays in charge of alignment and bubble styling only. This removes the `you` fallback: an
authorKind the surface does not know still names itself rather than claiming to be the human. The
weaver is the only other agent that can post into a session's thread, so an agent message that is not
the session's own is the weaver's. Alternative considered: keep the direction ternary and only swap
`session` for the role name — rejected because it still mislabels system and relayed messages and still
falls back to `you` on missing direction.

**D3. The role name comes from the worker detail, not from parsing the agent's name.** Add
`role: worker.roleId ? safe(() => s.roles.get(worker.roleId)) : null` to `GET /workers/:id`; the
client already declares and parses the field. The agent's stored name is `${role.name} — session`;
stripping that suffix in the UI was rejected as parsing a display string that is not a contract.
Fallback when `role` is null: the agent's own name, so the label is never empty.

**D4. Relayed and cross-device messages need no new storage.** A relayed human answer lives on the
decision (`decisions.answer` records `answerAuthorKind: 'human'`, `relayedFromMessageId`); if the weaver
speaks into a session thread it is an ordinary `agent` message with the weaver's `authorId`, which D2
labels `Weaver`. A human message from another device is the same operator on the same web-owned thread
(`authorKind: 'human'`), so `you` remains correct; the thread has no external sender.

## Risks / Trade-offs

- [The client's `WorkerDetail.role` is non-null-typed but was always null; adding it could surface
  assumptions elsewhere.] → The field is additive and the only consumer is this new label; the route
  test asserts it is present for a worker with a role and null without one.
- [Empty-state wording is a judgement call the human has opinions about.] → Chosen wording is stated
  in the spec's scenarios and shown in the rendered evidence; it can be adjusted in review without
  touching behavior.
- [A future runtime or channel writes a message kind this surface does not know.] → The fallback names
  the `authorKind` rather than defaulting to `you`, so the failure is visible and honest.

## Migration Plan

None: a UI default, an empty-state branch, a pure label resolver, and one additive response field.
Rollback is reverting the commit; no data or schema is touched.

## Open Questions

None.
