## Why

A worker that launches a long background job has no way to be woken when it is done: it ends its
turn with the Claude runtime's own `ScheduleWakeup`, whose timer lives inside the turn's process and
dies with it. Three times on 2026-09-12 a worker scheduled a check and no turn ever followed — one
sat idle for over ten hours while its job had finished on disk hours earlier. The wake queue already
accepts a delayed wake (`notBefore`) and the dispatcher already honours it; nothing in the product
ever asks for one on a worker's behalf.

## What Changes

- A new worker-only MCP tool, `weave_schedule_wakeup`, lets a worker schedule its own next turn:
  a delay or an absolute time plus a reason. It enqueues a wake for **the calling agent only**, with
  `notBefore` set, a bounded delay (a fixed minimum and maximum), a stable idempotency key, and at
  most one pending self-wake per worker — a second call replaces the first rather than stacking.
- The worker's own instructions (`skills/weave-ai-worker/SKILL.md` and
  `templates/worker.AGENTS.md.tmpl`) name the tool and say plainly that the runtime's scheduling
  tools do not survive the end of a turn and must not be relied on.
- Worker turns deny the runtime's own scheduler tools where the adapter supports it cleanly: the
  Claude adapter's `--disallowedTools` gains `ScheduleWakeup`, `CronCreate`, `CronList` and
  `CronDelete` (verified present in the installed 2.1.270 binary), applied only to worker runs.
- A pending self-wake is visible wherever a worker's status is: the `weave_worker_list` /
  `weave_worker_get` / `weave_run_inspect` tools, `GET /workers` and `GET /workers/:id`, and the web
  worker card, each showing the scheduled time and the reason.
- The supervisor's stalled-worker sweep treats a pending self-wake as an action path only while it
  is not yet past its own scheduled time by a clear margin; a worker idle well past its self-wake is
  reported stalled again.

**BREAKING**: none. A new wake source value and a new worker-only tool are additive; existing agents
and existing wakes are unaffected.

## Capabilities

### New Capabilities
- `agent-tools/self-scheduled-wake`: the worker-scoped scheduling tool, its bounds, replace
  semantics and caller-only routing; the dispatcher honouring the scheduled time; the tool being
  named in the worker instructions; denial of the runtime's own scheduler tools; and the pending
  self-wake surfacing on worker status views.

### Modified Capabilities
- `worker-supervision/stalled-worker-detection`: a queued self-wake defers the stalled verdict only
  until its scheduled time has clearly passed; a worker idle well past its own self-wake is detected
  as stalled.
- `worker-supervision/run-inspection`: the worker view reported by run inspection includes the
  pending self-wake's time and reason, so inspection does not read a scheduled wait as a stall.

## Impact

- `packages/shared/src/enums.ts` — a new `self_scheduled` wake source.
- `packages/shared/src/self-wake.ts` (new) — the delay bounds and the stalled grace margin.
- `packages/shared/src/tools.ts` — `weave_schedule_wakeup` in the worker-only set.
- `packages/core/src/api.ts`, `packages/core/src/wake/index.ts` — `WakeService.scheduleSelfWake`
  and `WakeService.pendingSelfWake`.
- `packages/core/src/supervisor/index.ts` — the stalled-worker query.
- `packages/core/src/testing/context.ts` — the wake-service test double.
- `packages/server/src/tools.ts` — the tool definition, and the pending self-wake on the worker
  tools.
- `packages/server/src/inspect.ts`, `packages/server/src/routes/workers.ts` — the pending self-wake
  on the inspection and HTTP worker views.
- `packages/core/src/runs/engine.ts`, `packages/runtime-sdk/src/index.ts`,
  `packages/runtimes/claude/src/adapter.ts` — worker-only scheduler-tool denial.
- `packages/ui/src/api/hooks.ts`, `packages/ui/src/components/WorkerCard.tsx` — render the pending
  self-wake.
- `skills/weave-ai-worker/SKILL.md`, `templates/worker.AGENTS.md.tmpl`, `docs/PLAN.md`,
  `docs/API.md` — the tool, the new wake source, and the warning.
