## Context

See proposal.md - Why. The default correlation key is built in one place,
`packages/core/src/decisions/service.ts` `create()`:

```ts
const correlationKey = input.correlationKey ?? `${input.kind}:${owner}:${requestedTicketId ?? 'workspace'}`;
```

`supersedeOpen()` then closes every `open` decision sharing that exact key before inserting the new
row. `requestedTicketId` is only ever set for a ticket-scoped ask; every ticketless ask — regardless
of kind, owner, or project — collapses onto the literal string `'workspace'`, so the bucket is really
`${kind}:${owner}:workspace` for all of them.

## Goals / Non-Goals

**Goals:**
- Two ticketless asks that are not the same logical question must never silently supersede each
  other, by default.
- The one legitimate ticketless supersede case — a caller deliberately re-raising the same question
  to replace its own earlier open card — must keep working, opt-in via explicit `correlationKey`.
- Ticket-scoped dedup (VS-519) must be byte-for-byte unchanged.

**Non-Goals:**
- Changing what a ticketless ask's `projectId` resolution does (`resolveProject` already resolves it
  correctly today; the bug is only in the correlation key, not the project the card is filed under).
- Changing the shape of `weave_ask`'s input or `DecisionCreateInput`.
- Persisting or exposing the correlation key anywhere it is not already recorded (`recordActivity`
  already logs it).

## Decisions

**Default a ticketless correlation key to something unique per call, not to `projectId`-scoped.**
The ticket's acceptance bar offers two levels: "at minimum include `projectId`" or "better, default
to a unique key per call". Scoping by `projectId` alone would still collide two unrelated
project-less asks (`projectId` absent on both, e.g. two different ticketless questions about the
workspace as a whole) and would still collide two different questions about the *same* project on
the same day. Only per-call uniqueness satisfies "a new card supersedes an old one only when the
caller means it to" for every ticketless case, and it is what the ticket asks for as the better fix.
The call's own new decision `id` (already generated via `newId()` for the row itself) is reused as
the uniqueness source — no new ID generation, no new column, and it makes the key inspectable
(`recordActivity`'s `correlationKey` field ties straight back to the decision it was minted for).

**Scope the new default to the three askable kinds (`question`, `concern`, `gate_finding`), not to
every kind that can reach `create()`.** The first revision of this design branched only on
`requestedTicketId` being absent, applied inside the one shared expression every kind computes its
default from. A review concern raised against that revision: because the branch lived in the general
default-key path, any future ticketless caller of a system-owned kind (`retry_approval`,
`hire_approval`, `merge_approval`, `plan_approval`, `action_approval`, `discard_approval`,
`promotion_approval`) that omitted an explicit `correlationKey` would silently start getting
per-call-unique keys too, changing its dedup semantics as a side effect of a bug fix aimed only at
`weave_ask`. The concern cited `packages/core/src/runs/engine.ts` `parkForHuman`'s `retry_approval`
(~line 1522) as a call already relying on the old default for its supersede behavior.

That citation does not hold against the code as it stands: `parkForHuman` has passed an explicit
`correlationKey: \`retry:${f.agent.id}\`` since 2026-09-05 (commit `1d537df3f`), for every agent kind
that reaches it, weaver and planner turns included (the surrounding `f.agent.kind === 'weaver' ? ... :
...` branch only picks the settings name in the title/context, not the correlation key) — so today's
per-agent retry supersede does not depend on, and is not touched by, the ticketless default this
change replaces. See the caller audit below: it did not turn up any call that both omits
`correlationKey` and can be ticketless.

The scoping is still adopted anyway, as the safer of the two options the concern offered: it costs one
extra condition, it matches exactly what the ticket asks for ("check... `concern`/`gate_finding` kinds,
and fix it consistently" — never "every kind"), and it means a future system-owned kind added to
`create()` without an explicit key falls back to today's ticket-or-workspace derivation instead of
silently picking up per-call uniqueness it never asked for.

**Branch on presence of `requestedTicketId`, not on the asker's agent kind, within the askable-kind
case.** The ticket asks to "check whether the same collision applies to worker asks with no
ticket... and fix it consistently". A `worker`-kind agent's run always carries a ticket claim in
practice, but a ticketless *session* agent's ask resolves to the same `owner: human` path a weaver's
does (`defaultOwner`), through the same `create()` call. Keying the fix off "is there a ticket" rather
than "who is asking" covers both without adding a second code path or a kind check that could drift
from `defaultOwner`'s own rules.

### Caller audit

Every production call to `decisions.create()`, and whether it can be ticketless and whether it passes
an explicit `correlationKey` — the two conditions that decide whether this change can touch it at all
(only "ticketless AND no explicit key" reaches the new branch, and only for an askable kind):

| Call site | Kind | Ticketless? | Explicit `correlationKey`? |
|---|---|---|---|
| `models/index.ts:123` (workers-runtime migration card) | `question` | yes | yes — `WORKERS_RUNTIME_CORRELATION` |
| `runs/authgate.ts:121` (runtime-wide login outage) | `gate_finding` | yes (deliberately, see its own comment) | yes — `loginCorrelationKey(runtimeId)` |
| `runs/authgate.ts:143` (per-ticket login outage notice) | `gate_finding` | no (`ticketId` required) | yes — `authOutageCorrelationKey(ticketId)` |
| `runs/engine.ts:1369` (three empty turns) | `gate_finding` | no (`f.agent.ticketId` required by the caller's guard) | yes — `empty-turns:${agentId}` |
| `runs/engine.ts:1522` (`parkForHuman` retry/quota) | `retry_approval` | can be (ticketId nulled for a ticketless weaver/planner) | yes — `retry:${agentId}` (since 2026-09-05) |
| `supervisor/index.ts:783` (stalled-worker escalation) | `gate_finding` | no (`ticketId: row.ticketId`) | yes — `stalled-worker:${workerId}` |
| `roles/index.ts:153` (hire approval) | `hire_approval` | yes (roles are not ticket-scoped) | yes — `hire:${roleId}` |
| `roles/index.ts:241` (role-permission change) | `hire_approval` | yes | yes — `role-permission:${roleId}` |
| `roles/index.ts:348` (retire with live workers) | `discard_approval` | yes | yes — `retire:${roleId}` |
| `promotion/index.ts:319` (promotion approval) | `promotion_approval` | yes (project-scoped, not ticket-scoped) | yes — `promotion_approval:${projectId}` |
| `tickets/service.ts:535` (`raisePlanApproval`) | `plan_approval` | no (`ticketId: t.id`) | yes — `plan_approval:${t.id}` |
| `tickets/service.ts:555` (`raiseActionApproval`) | `action_approval` | no | yes — `action_approval:${t.id}` |
| `tickets/service.ts:893` (merge approval on `in_review`) | `merge_approval` | no | yes — `merge_approval:${t.id}` |
| `tickets/service.ts:2140` (merge approval repair sweep) | `merge_approval` | no | yes — `merge_approval:${t.id}` |
| `routes/tickets.ts:180` (discard approval) | `discard_approval` | no | yes — `discard:${ticketId}` |
| `server/tools.ts:596` (`weave_ask`) | `question` \| `concern` \| `gate_finding` | **yes, routinely** (ticketId defaults to the caller's own claim, which is `null` for the weaver and a ticketless session) | **no** — `i.correlationKey` is whatever the MCP caller passed, routinely `undefined` |

`weave_ask` is the only call that is both ticketless and keyless by default. Every system path already
carries its own explicit key, so the askable-kind scoping does not change any of their behavior today —
it only forecloses a class of future accident.

## Risks / Trade-offs

- **A caller relying on the old accidental bucketing to intentionally replace a ticketless card**
  would need to start passing an explicit `correlationKey`. No such caller exists today: `weave_ask`'s
  only ticketless raiser is the weaver's own use of the tool and, per `askedByWorker`, a ticketless
  session; neither passes `correlationKey` for a deliberate-replace today; this proposal's own
  acceptance criteria treat that old behavior as the bug being fixed, not a feature to preserve.
- **Correlation key format changes** for a ticketless askable-kind decision (`workspace` literal
  replaced by a decision id). Nothing parses this string outside `decisions/service.ts` itself (`grep`
  confirms `correlation_key` is only ever compared for equality, never pattern-matched, in application
  code — the one `LIKE` pattern in the codebase is `merge_approval:archive:%`, an unrelated, always
  ticket-scoped key this change does not touch).
- **A future system-owned kind raised ticketless with no explicit key** would fall back to
  `${kind}:${owner}:workspace` exactly as today (unaffected by this change, per the scoping decision
  above) rather than getting per-call uniqueness for free. That is judged correct: a new call site
  should choose its own dedup key deliberately, the way every current one does, not inherit whichever
  default this ticket's askable-kind fix happens to leave in place.
