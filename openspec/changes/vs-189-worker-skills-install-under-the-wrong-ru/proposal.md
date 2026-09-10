## Why

Every live worker in this workspace runs on the `claude` runtime, but a worker's home has its skills
installed under whichever runtime was resolved the first time its home was rendered — usually at spawn.
`ensureHomeCurrent()` (`packages/core/src/workers/home.ts`) only re-renders a home when the agent's brief
or role-spec revision moved; it has no notion that the agent's *runtime* can also change between renders.
`packages/core/src/runs/engine.ts` deliberately re-resolves and corrects `agent.runtimeId` on every turn
(so a stale DB row can never decide what a turn launches), but that correction happens moments *before*
`ensureHomeCurrent` runs — and `ensureHomeCurrent` throws the new value away when deciding whether to
re-render, because its marker never recorded a runtime in the first place. A worker whose runtime was ever
resolved differently between two renders is left with skills only under the old runtime's path forever;
`skills/manifest.json` maps `claude` to `.claude/skills/<name>/SKILL.md`, so on the claude runtime none of
the four worker-audience skills resolve, and the worker runs its whole life without its operating contract.

VS-185 (merged after this ticket was filed, ADR 0013) confirmed the diagnosis rather than changing it:
every runtime/model resolution call site — spawn, dispatch, the turn engine, session creation, the auth
gate — now goes through the one function `modelSettingFor(modelsFor(ctx), kind, ticket)`, so there is a
single, consistent answer to "what runtime is this agent on right now" everywhere it is asked. That answer
can still change between two renders of the same worker's home — a workspace's own settings changing, a
ticket's `workerModelId` resolving to a different catalog entry, or now also a daemon-level overlay
(VS-185's new mechanism) taking effect for every workspace at once with no per-worker action at all. VS-185
added no hook that re-renders an existing agent's home when the daemon overlay changes, so it makes this
bug's trigger *more* likely to recur, not less. The fix below is unaffected by VS-185 otherwise: it does
not touch how the effective runtime is resolved, only whether a home is re-rendered when that already-
correct answer differs from what the home last saw.

## What Changes

- `packages/core/src/workers/home.ts`'s render marker SHALL record the runtime a worker's home was last
  rendered for, alongside the brief/spec revisions it already tracks.
- `ensureHomeCurrent()` SHALL treat a runtime that no longer matches the marker the same way it already
  treats a moved brief or role-spec revision: as a reason to re-render the home, which re-installs skills
  through the runtime adapter that is actually resolved for this agent right now.
- This is a self-healing fix, not a one-time repair: any currently-live worker's marker predates this
  field, so its first turn after this change lands re-renders unconditionally and lands its skills at the
  correct path — no hand-edit of a running workspace's worker homes (per the ticket's own note).
- A regression test SHALL assert, directly against `skills/manifest.json`, that a freshly rendered home
  puts each worker-audience skill under the path its resolved runtime declares, for at least the `claude`
  and `opencode` runtimes, and that only worker-audience (+ `all`-audience) skills land in a worker home.
- A regression test SHALL assert that a worker whose runtime changes after its home already exists gets
  the new runtime's skill directory populated on the next render (stale-path copies from the old runtime
  are not required to be removed).

## Capabilities

### New Capabilities
- `worker-provisioning/runtime-skill-path`: a worker's installed skills track its currently-resolved
  runtime, not the runtime that happened to be resolved the first time its home was rendered.

### Modified Capabilities
(none — no existing spec covers worker-home skill installation; see Impact)

## Impact

- `packages/core/src/workers/home.ts` — `Marker`, `currentRevisions()`, `ensureHomeCurrent()`.
- `packages/core/src/workers/home.test.ts` (or equivalent, colocated per project convention) — new
  regression tests reading `skills/manifest.json` directly, covering `claude` and `opencode`.
- No route, CLI, schema, or UI change. No change to `packages/runtimes/*` adapters — each adapter's
  `installInstructions` already installs at the correct path for whatever runtime it is; the bug is only
  in the decision of *when* to call it again.
