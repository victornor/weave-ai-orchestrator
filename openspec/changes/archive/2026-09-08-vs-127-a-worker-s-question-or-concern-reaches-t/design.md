## Context

Two findings from reading the current code, both cited in the ticket and confirmed here with file:line evidence:

1. **The ownership bug is in the tool, not the service.** `packages/core/src/decisions/service.ts`'s
   `create()` already has the right shape: `owner = input.owner ?? defaultOwner(input.kind, ticketId)`,
   and `defaultOwner` is a real, tested function (`packages/core/src/decisions/decisions.test.ts:53-57`
   exercises its `plan_approval`/`gate_finding` branches directly against the service). But every
   production caller of `decisions.create()` passes `owner` explicitly, so `defaultOwner` is currently
   dead in production. The `ac_ask` tool (`packages/server/src/tools.ts:282`) is the one that matters
   here: `owner: i.kind === 'gate_finding' ? 'conductor' : 'human'`. It never asks who is calling —
   only what `kind` they named — so a worker that calls `ac_ask` with no `kind` (the schema default is
   `'question'`) lands on the human every time, exactly as VS-124 did.

2. **A `blocked` ticket wakes nobody.** `tickets/service.ts`'s `transition()` (`packages/core/src/tickets/service.ts:318-325`)
   sets `blockedTransitionAt`, `blockedFromStatus` and `unblockJson` when a ticket enters `blocked`,
   but calls no `wake()` for either owner. The only path that notices is `conductorDigest()`
   (`packages/core/src/supervisor/index.ts:337-368`): `ticket.status` events are digest-worthy unless
   the new status is routine, and `blocked` is not in `ROUTINE_TICKET_STATUSES`, so a blocked ticket
   is eventually reported — but only the next time the digest interval (`conductorDigestIntervalSec`,
   default 120s) has elapsed *and* something digest-worthy has happened since the last one. That
   confirms the ticket's suspicion: this is a periodic, batched sweep, not the dedicated,
   immediate wake a `gate_finding` gets at the moment it is raised
   (`decisions/service.ts`: `if (owner === 'conductor') wake(conductorId(), ...)`).

`docs/SCENARIOS.md`'s own worked example ("Needs a decision") already documents a worker's `ac_ask`
landing on the conductor as a `gate_finding` and being decided or escalated from there — so the
target behavior here is not new invention, it is making the one documented path the only path,
instead of an opt-in a worker has to remember.

## Goals / Non-Goals

**Goals:**
- Fix the ownership resolution at the layer that already has the right shape (`defaultOwner`), so
  no future tool or caller can reintroduce the same bug by hard-coding owner again.
- Close the adjacent hole the investigation surfaced: `ac_ask` can currently name
  `plan_approval`/`merge_approval`/`hire_approval`/`discard_approval`/`retry_approval` as `kind`,
  which (a) is never a legitimate worker action and (b) can collide with a real approval's
  correlation key and supersede it (`supersedeOpen` keys only on `ticketId` + `correlationKey`,
  not owner).
- Give a worker a way to ask for help that does not require it to invent options (AC3), without
  adding a second tool that would fragment "the worker's way to reach the conductor" into two APIs.
- Make a conductor-owned `blocked` ticket wake the conductor the same way a conductor-owned decision
  already does.

**Non-Goals:**
- Changing who owns `plan_approval`, `merge_approval`, `hire_approval` or `discard_approval`, or how
  they are raised. Out of scope per the ticket, and untouched by this design.
- A new mechanism for the conductor to escalate a worker's ask to the human. The tools already exist
  and already compose (see Decisions, "Escalation is a workflow, not new plumbing").
- Letting a worker message the human in any form.

## Decisions

### Resolve ownership by who is asking, inside `defaultOwner`, not inside the tool

`defaultOwner(kind, ticketId)` becomes `defaultOwner(kind, ticketId, askedByAgentId)`. For `question`
and the new `concern` kind, it looks up the asking agent's `kind` (`worker` | `conductor`) and returns
`conductor` for a worker, `human` for the conductor — exactly the rule AC1 states, independent of
which of the three askable kinds was named. `gate_finding` keeps its unconditional `conductor` (no
behavior change there — it was already correct). The `ac_ask` tool handler stops passing `owner` at
all and lets `create()` resolve it.

**Alternative considered:** fix only `packages/server/src/tools.ts`'s handler (compute the right
owner there and keep passing it explicitly). Rejected: that is exactly today's bug pattern — the
tool deciding ownership instead of the service — and leaves the same trap for the next caller that
constructs a decision without going through this one handler (there is already more than one: HTTP
route equivalents, if any are added later, would inherit the bug again). Fixing `defaultOwner` means
every caller that omits `owner` gets the correct answer, including ones that do not exist yet.

### Narrow what `ac_ask` can construct, at the schema layer

A new `ASKABLE_DECISION_KINDS = ['question', 'concern', 'gate_finding']` replaces
`z.enum(DECISION_KINDS)` on `AskSchema.kind`. Zod rejects anything else before a decision row is ever
considered, for both a worker and the conductor.

**Alternative considered:** leave `kind` as the full `DECISION_KINDS` enum and refuse the dangerous
ones inside the handler with an `OcError`. Rejected: strictly more code for the same outcome, and a
schema-level cut is the same technique the ticket's own investigation found missing (kind selection
must not be able to reach the human's queue or a system-owned kind).

### `concern` is a new decision kind, not a rewording of `question`

A worker already *can* call `ac_ask` today with just a title and context and no options — the schema
never required them. What discourages that framing is the tool's description ("Ask for a decision...
Give real options and a recommendation") and the fact that a bare `question` and a real multiple-
choice question look identical in the decision list, the digest, and the conductor's own read of its
queue. `concern` is a distinct, cheap label for "I'm stuck, not deciding" that:
- renders like `question` (free text, no forced buttons) rather than falling back to the generic
  `approve`/`reject` card `VARIANTS[d.kind] ?? 'approval'` would otherwise produce for an unrecognized
  kind,
- lets the conductor's own view, and any future digest filtering, tell "the worker needs help" apart
  from "the worker wants a decision made" without parsing prose.

**Alternative considered:** a dedicated `ac_worker_concern` tool. Rejected: it would duplicate
`ac_ask`'s entire plumbing (ticket/project resolution, correlation keys, expiry, the wake-on-create
path) for a payload shape `ac_ask` already accepts. A new enum value plus a tool-description update
is the smaller, more honest change — one tool, three askable kinds, each meaning something distinct.

### `decisions.kind`'s CHECK constraint needs a table rebuild

SQLite cannot alter a CHECK constraint. `0010_decision_kinds.sql` already establishes the recipe
(rebuild via `decisions_new`, `INSERT ... SELECT *` matched by position, drop, rename, recreate both
indexes) for exactly this reason — `retry_approval` was added the same way. The new migration follows
it, using the table's current full column list (base columns plus `project_id`, `inputs_json`,
`answer_inputs_json`, added later by `0013_decision_project_inputs.sql` via plain `ALTER TABLE ADD
COLUMN`, which is safe to append after a rebuild). `decisions` remains a leaf table — nothing
references it — so the same safety argument `0010` documents still holds.

### Blocked-on-conductor wakes from `transition()` itself, not from each caller

`tickets/service.ts`'s `transition()` already has a `conductorId()` helper (used for the openspec-
archive-failure wake) and already knows `input.unblock` via `facts()`. Adding one wake call there —
`if (to === 'blocked' && input.unblock?.owner === 'conductor') wake(conductorId(), 'ticket_blocked', ...)`
— covers every caller that can drive a ticket to `blocked` with a conductor-owned unblock action,
present and future, the same way fixing `defaultOwner` covers every caller of `decisions.create()`.

A new `WAKE_SOURCES` value, `ticket_blocked`, is added rather than reusing `'system'`, matching the
existing convention of a specific source per specific trigger (`blockers_resolved`,
`children_completed`).

**Alternative considered:** wake from the `ac_ticket_transition` tool handler instead. Rejected for
the same reason as the `ac_ask` fix — the guarantee belongs where the state actually changes, not in
one caller of it. `decisions.expireDue()` already separately wakes the conductor when an expired
decision blocks a ticket; that call is untouched and becomes a harmless second wake in the rare case
where both fire for the same event, which is not worth special-casing away.

### Escalation is a workflow, not new plumbing

AC4's second half — "if the conductor escalates instead, the worker is told it is waiting on the
human rather than being left silent" — does not need a new tool. The pieces already exist and already
compose:
1. The conductor raises its own `ac_ask` (owned by `human` under the rule above), naming the worker's
   ticket, with its own framing and recommendation — exactly `docs/SCENARIOS.md`'s existing worked
   example.
2. The conductor calls `ac_worker_message` (`packages/server/src/tools.ts:480`) to tell the worker,
   on its ticket, that this is now with the human — auditable, and delivered mid-turn or queued by
   the existing steering mechanism.
3. When the human answers, the conductor is woken (it is the asker of its own escalation decision)
   and relays the resolution to the worker's original decision with `ac_decision_answer`, which wakes
   the worker with the answer through the same path a direct answer already uses.

No decision-reassignment mechanism, and no new tool, is needed for this. It is a difference in what
the conductor's skill and prompt tell it to do, not in what the system enforces — the same reason
AC6 ("an answer from the conductor is instruction, and does not bypass a plan or merge approval") is
already true today: nothing about answering a `question`/`concern`/`gate_finding` decision touches
ticket status or approval kinds.

## Risks / Trade-offs

- **[Risk]** A worker relying on today's (wrong) behavior — a bare `ac_ask` reaching the human
  directly — silently starts reaching the conductor instead. → Mitigation: this is the fix, not a
  side effect; `docs/SCENARIOS.md` already documents the conductor as the intended first stop, and
  the worker-facing skill is updated in the same change so the documented and actual behavior agree.
- **[Risk]** The `decisions` table rebuild is a full copy under a transaction; on a very large
  `decisions` table this could be a slower migration than an `ALTER TABLE`. → Mitigation: this table
  is bounded by decision volume, not run/event volume, and `0010` already took this cost once at
  comparable scale; no new mitigation needed.
- **[Trade-off]** `concern` and `question` behave identically (free text, conductor recommends or
  answers) — the distinction is purely a label for the humans and conductor reading the queue, not a
  new code path. Accepted: the ticket asked for a cheap way to ask, not a heavier one.

## Migration Plan

Additive only: new enum value, new migration, new wake source, one schema narrowing on a tool that
already validates its input with Zod. No backfill needed — existing decisions keep their existing
`kind` and `owner`. No rollback complexity beyond a normal revert; the migration rebuild is the only
irreversible-in-place step, and it only adds an allowed value to a CHECK, so reverting the code
without reverting the migration leaves `concern` an inert, unused value in the CHECK — harmless.
