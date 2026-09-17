## Context

`weave_ticket_create` (`packages/server/src/tools.ts`) is `scope: 'all'` — the weaver, a worker and a
persistent session all get it. Its handler passes `workerModelId` straight to
`tickets.create(actor, …)` in `packages/core/src/tickets/service.ts`, which calls
`resolveWorkerModelId`: a present id is validated against the effective catalog
(`effectiveModels(ctx.daemon, ctx.config).workerOptions`), a missing id resolves to `null`, and a
`null` ticket column makes the worker run on `models.workers`.

The service is also the single creation point for callers that have no agent choosing:

| Caller | Actor | Path |
|---|---|---|
| `projects.describeTicket` | whoever added the project | project-description scout |
| `workers.spawnCurator` | whoever triggered curation | knowledge-curation task |
| `workers.startInteractiveSession` | human/system | new interactive session ticket |
| `workspace/portable.importTickets` | `SYSTEM` | workspace import |
| `POST /tickets`, `weave` CLI | human | web / CLI create |

The effective catalog is the workspace's own non-empty `workerOptions`, else a filled daemon
overlay, else `[]`. A daemon with no `daemon.yaml` models block is seeded with
`DEFAULT_WORKER_TIERS` (VS-236) — three options (`quick`, `standard`, `deep`) whose descriptions are
the when-to-use copy, **all with `runtime: null`** until an operator chooses an adapter. So "a
catalog exists" and "a usable option exists" are not the same state, and the fresh-install state is
the second.

## Goals / Non-Goals

**Goals:**
- Omitting `workerModelId` on the agent-facing ticket tools stops being a silent default when a real
  choice is available, and the failure itself teaches the catalog.
- The non-agent paths and the unusable-catalog states keep working exactly as today.
- The requirement is stated in the tool descriptions and the weaver's instructions before it is hit.

**Non-Goals:**
- Changing what the tiers are, their runtimes/models, or how a run resolves one.
- Guessing a tier from the ticket text.
- Making the HTTP/CLI or system paths require the field.
- Widening which agents may read the catalog (`weave_worker_models` stays weaver-only, per
  `model-selection/worker-options`).

## Decisions

### Enforce at the tool boundary, not in `tickets.create`

The guard lives in the `packages/server/src/tools.ts` handlers, which sit in front of every agent
(weaver, worker, session) and in front of nothing else. The service stays permissive, so
`describeTicket`, `spawnCurator`, `startInteractiveSession`, `importTickets` and the HTTP/CLI path
keep the default without special-casing their actors.

*Alternative rejected:* enforcing in `tickets.create` gated on `actor.kind !== 'system'`. The
curation and session paths are agent- or human-triggered but are not an agent choosing a tier, so
that gate would either break them or need an allowlist of exempt callers — more surface than the
rule it protects. *Alternative rejected:* enforcing in the HTTP route too, which would change the
human workflow the proposal keeps out of scope.

### The trigger is "at least one *configured* option", not "a non-empty catalog"

`isWorkerOptionConfigured(opt)` is `opt.runtime != null`. A seeded fresh install has a non-empty but
fully-unconfigured catalog; requiring a pick there is unsatisfiable and would block every filing on
every new workspace — exactly the "required field that blocks an automated path is a worse bug"
failure. The guard therefore enforces only when `options.some(isWorkerOptionConfigured)`; the error
lists only configured options. An explicit request for an unconfigured option is still refused by
`resolveWorkerModelId` with `model_unconfigured`, unchanged.

*Trade-off, stated plainly:* on a fresh install the silent-default behavior survives until the owner
configures at least one tier. That is the one state in which the old bug can still occur, and it is
preferable to a hard block. The spec records it as the empty-or-fully-unconfigured case.

### One shared guard and one teaching message

```
chooseWorkerModel(ctx, requested) -> string | null
```

If the effective catalog has no configured option, return `requested ?? null` (default preserved).
If the requested id is missing/empty, throw `OcError('validation', message, { options })` where
`message` names each configured option as `- <id>: <description>`. An id not in the catalog is
refused naming the valid ids; an id that exists but has no runtime is left to
`resolveWorkerModelId`'s `model_unconfigured`. `weave_ticket_create`, `weave_ticket_assign` (only
when it attaches a role and the ticket currently names none) and `weave_session_take_ticket` (the
new-ticket branch) all call it. The session tool's existing-ticket branch adopts a ticket already
created elsewhere, whose model was settled at creation, so it is deliberately unchanged.

### Unknown ids name the valid ids

`resolveWorkerModelId`'s `unknown worker model option 'x'` gains the valid ids so the same
teaching property holds on a typo as on an omission. This is a message-only change in the service
and benefits every caller.

### Assign and session-take are in scope; roadmap items and plan drafts need nothing

- `weave_ticket_assign` attaching a role is the same act as create-with-role, just later, and it is
  the path a system-filed or human-filed ticket reaches a worker through.
- `weave_session_take_ticket` creates or adopts a ticket for an agent, so it is the same decision.
- Roadmap items are filed *through* `weave_ticket_create` when a block is started, so they are
  covered with no schema change; adding a tier to `weave_roadmap_item_add` would duplicate the
  choice rather than record it.
- A submitted plan's drafts already carry `suggestedTier` / `tierOverride`, and the weaver is
  instructed to carry the effective tier onto `weave_ticket_create`, which now validates it.

### Workers and sessions cannot pre-read the catalog

`weave_worker_models` is weaver-only by spec, and this change does not widen it. A worker or session
filing a ticket learns the options from the refusal's message and retries — the teaching error is the
documented path for them. The weaver, which files nearly all tickets, has the tool and is told in its
instructions to use it.

## Risks / Trade-offs

- **A fresh install keeps the silent default until a tier is configured.** → Documented and tested;
  when any option becomes configured the rule starts applying with no restart.
- **An extra failed tool call for a worker filing a follow-up.** → The refusal message carries the
  full option list, so exactly one retry is needed, and this is the intended teaching moment.
- **A populated catalog whose sole configured option is a poor fit** leaves an agent no way to express
  "no good option". → Out of scope by the ticket: choosing a tier is the requirement, and the agent
  may still raise an ask.
- **Message size**: listing up to 16 options at 200 chars each is bounded and only on the error path.

## Migration Plan

No data or schema migration. Deploy with the normal daemon upgrade; rollback is reverting the
commit. Existing tickets keep their stored `workerModelId` (or lack of one); nothing is backfilled.

## Open Questions

None that change the specs, approach or task breakdown.
