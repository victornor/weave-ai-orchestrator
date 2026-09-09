## Context

See `proposal.md` for the motivation. Current spawn gate in `packages/core/src/workers/index.ts`:

```
if (roles.freeSlots(role.id) <= 0) throw role_full   // role.maxWorkers − live(role)
if (liveInProject(project.id) >= project.maxWorkers) throw role_full
```

`RolesService.concurrency` reports `effective: Math.min(role.maxWorkers, project.maxWorkers)` and `free` as the tighter of the two remaining counts. Hire defaults `RoleSpecSchema.maxWorkers` to 2. Team's role sheet (`MaxWorkersField`) and `{live}/{r.maxWorkers}` readout, `ac_role_set_max_workers`, and `conductor role set-max-workers` all write that field. Settings already edits `project.maxWorkers` (1–32).

Dispatcher (`packages/core/src/runs/dispatcher.ts`) already skips a *turn* when `projectRunning(projectId) >= project.maxWorkers`. It does not consult `role.maxWorkers`. Host `defaults.maxConcurrentRuns` (default 6) is a separate in-memory turn cap across the whole daemon.

## Goals / Non-Goals

**Goals:**
- One spawn gate: `liveInProject >= project.maxWorkers`.
- Concurrency reporting and Team UI match that: no per-role cap presented as the thing that queues work.
- Existing tests that encoded the role cap are rewritten, not deleted.

**Non-Goals:**
- No schema/migration. `roles.max_workers` stays as a stored column and `RoleSpecSchema.maxWorkers` stays on the hire payload so existing role.yaml files and `PATCH /roles/:id` keep validating.
- Not removing `ac_role_set_max_workers` or `conductor role set-max-workers` (MCP/CLI surface). They keep writing the stored field; they stop mattering for spawn. Routing copy is updated so the conductor does not think raising them unblocks a queue.
- Not changing `defaults.maxConcurrentRuns`. It is a host-wide *turn* cap (already-spawned agents wait for a dispatcher slot). It does not refuse `workers.spawn`, so it is not the class of hidden cap that queued VS-154. If a project is set to 10 and the host default is still 6, at most 6 turns run at once (including the conductor) even though 10 workers can be live. Changing that is a follow-up.
- Not changing role pause/resume, dispatcher isolation, or Fernwood's current numbers.
- Not changing the dispatcher's existing per-project turn skip (`projectRunning >= project.maxWorkers`). That already keys off the project.

## Decisions

**Drop the role spawn gate; keep the project one.** `workers.spawn` deletes the `freeSlots` check and keeps `liveInProject >= project.maxWorkers`. Same `role_full` code, message names the project. Supervisor's `spawnPending` already treats `role_full` as "wait and warn the conductor"; that path now means the *project* is full.
- Alternative: keep both gates but default `role.maxWorkers` to 32. Rejected — a stored per-hire number the Team page can still lower would recreate VS-154 the next time someone "tunes" a role.

**`concurrency` and `freeSlots` become project-pooled.** `effective = projectMax`. `free = max(0, projectMax − projectLive)`. `roleMax` still echoes the stored field so existing `GET /roles/:id` / `ac_role_get` consumers do not break. `freeSlots` returns the same number as `concurrency.free` (no remaining caller should treat it as role-only; spawn will not call it).
- Alternative: delete `roleMax` / `freeSlots`. Rejected as a noisier API break for one ticket; the spawn gate is what actually queued work.

**Stop exposing the Team editor; leave the conductor/CLI write path.** Remove `MaxWorkersField` and the `{live}/{r.maxWorkers}` list readout from `Team.tsx`. Hire-approval cards (`packages/render/src/decision.ts`) stop showing a "Max workers" row so a hire is not presented as choosing a cap. Keep `ac_role_set_max_workers` and the CLI command so MCP tool lists and existing scripts do not 404; they become a stored-field write with no spawn effect. Hire skill and conductor routing stop instructing anyone to raise a role cap to drain a queue — the advice becomes "raise the project's Settings max-workers, or wait for a project slot".
- Alternative: delete the tool. More breakage than the ticket needs; a later cleanup can drop it once nothing calls it.

**Keep `RoleSpecSchema.maxWorkers`.** Hire still accepts and stores it (default 2). It is inert for spawn. No migration of existing role.yaml files.
- Alternative: default it to 32 or remove the field. Either is a schema change that forces every hired role's spec rewrite for no spawn-path gain once the gate is gone.

**`maxConcurrentRuns` stays.** Documented here so the human sees it. It limits concurrent *turns* on the host, not how many workers exist. VS-154's failure was `spawn` throwing `role_full` before a worker existed; this ticket fixes that path.

## Risks / Trade-offs

- [One busy role can consume every project slot; a quieter role waits] → Accepted. That is the requested model: the project cap is the only cap. Pause the busy role if it should yield.
- [Stored `role.maxWorkers` still exists and `ac_role_set_max_workers` still writes it, so a future reader may think it is a cap] → Team UI and routing copy are updated this ticket; a comment on `concurrency()` states the field is not a spawn gate. A later ticket can delete the field.
- [Host `maxConcurrentRuns` of 6 still serialises turns below a project cap of 10] → Called out; out of scope. Workers spawn; they wait for a dispatcher slot rather than never existing.
- [Existing tests assert `role_full` when `role.maxWorkers` is 1] → Rewrite those to the project cap; add the two-role / cap-3 / default-2 case the ticket names.

## Migration Plan

No data migration. After deploy, the next supervisor `spawnPending` sweep uses the project gate only. Existing roles keep their stored `maxWorkers`; it is ignored at spawn. Rollback is the previous release: the role gate returns.

## Open Questions

None. The ticket's "remove the role cap from spawn, or stop exposing it" is resolved above: both, for the human-facing Team control; spawn-only for the MCP/CLI write path.
