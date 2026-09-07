## Context

See `proposal.md` — Why. VS-99 (`openspec/changes/archive/2026-09-07-vs-99-…`) already built the
mid-turn channel end to end — `TurnHandle.send`, `ActiveRun.send`, `WorkersService.message(actor,
workerId, body, { live })` — and made one explicit decision to leave out: *"The existing conductor
relay calls it without `live` and keeps queued behavior."* This change revises exactly that one
decision. Everything else VS-99 decided (the Claude adapter's stream-json stdin, the exactly-once
rule, attribution order, the `human.input` event, `GET /workers/:id` capability reporting) is reused
without modification.

## Decisions

### 1. `live: true` is the tool's default, not the service's

`WorkersService.message`'s own default (`opts.live` falsy → queued) is left exactly as VS-99 wrote
it — other callers of the service (there are none today besides the two HTTP-adjacent entry points)
keep today's behavior if they ever omit the option. `ac_worker_message`'s Zod input schema gets
`live: z.boolean().optional()`, and its handler resolves the omitted case to `true` before calling
the service: `{ live: i.live ?? true }`.

*Alternative considered:* flipping the service's own default to `true`. Rejected — the service has
no notion of "conductor vs. other callers"; a caller-agnostic default change is a wider blast radius
than this ticket's acceptance criteria ask for, and `POST /workers/:id/message` (the human/CLI path)
already gets to choose explicitly per VS-99. Defaulting in the tool keeps the change local to the one
path the ticket names.

*Alternative considered:* the CLI's `worker message` command (`packages/cli/src/commands/worker.ts`)
also defaulting to live. Out of scope — the ticket is about the conductor agent's tool, not the human
operator's CLI, and the CLI already goes through the HTTP route directly, unaffected by this change.

### 2. Nothing about delivery mechanics changes

The tool handler is a pass-through: `svc(ctx).workers.message(ctx.actor, i.workerId, i.message, {
live: i.live ?? true })`. The service still attributes the ticket comment first, still tries the
running turn only when `runState(ctx).active` has a `send`, still falls back to the queued wake on
`closed`/`unsupported`/throw, still records exactly one `human.input` event, still leaves every open
decision and every permission/tool-list config untouched. No new code path exists for "the conductor
is asking" — the actor on the call is whatever `ctx.actor` already is (`{ kind: 'agent', id:
'conductor' }` for a conductor-scoped run token), same attribution as today.

### 3. Test coverage adds the conductor's path, it does not rewrite the service's

`packages/core/src/workers/workers.test.ts` already has a full suite proving the service's mid_turn/
queued mechanics for a `HUMAN` actor (mid-turn delivery, queued when `live` is not asked for, queued
when `send` is absent or reports `closed`, queued and still-attributed when `send` throws, no
widening of permissions or decisions). VS-103 adds the same "does not widen anything" assertion for a
conductor actor, plus a tool-level test asserting the *default* — the thing this ticket actually
changes lives in `packages/server/src/tools.ts`, so a server-level test on `ac_worker_message`'s
handler (or the MCP dispatch path) is what proves the default, not another copy of the core
mechanics test.

The existing core-level test ("the conductor's own relay never asks for `live`, so it keeps today's
one queued path", `workers.test.ts:262`) is retitled, not deleted: it still correctly documents that
*the service's own default* is queued when a caller omits `live` — that is still true and still worth
pinning. What changed is that the tool the conductor actually calls no longer omits it.

## Non-Goals

- Any change to `WorkersService.message`'s signature, default, or the transport VS-99 built.
- Letting the conductor answer a decision, approve, merge or cancel on a worker's behalf (ticket's
  own Out of Scope).
- The CLI's `worker message` command or the interactive session (VS-101).
