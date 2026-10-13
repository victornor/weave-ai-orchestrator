## Context

See `proposal.md` for the motivation. The relevant code today:

- `packages/core/src/workers/home.ts`'s `renderHome()` always calls
  `ctx.registries.runtimes.get(agent.runtimeId)` and installs skills through that runtime's
  `installInstructions`, so *when it runs* it always uses the currently-correct runtime — that part is
  not the bug.
- `ensureHomeCurrent()` decides *whether* to call `renderHome()` again, from a `Marker` written to
  `.ac-render.json` in the home. `Marker` today is `{ briefRevision, specRevision, roleRevision,
  renderedAt }` — no runtime.
- `packages/core/src/runs/engine.ts:228` resolves `setting = modelSettingFor(modelsFor(ctx), agent.kind,
  ticket)` fresh on every turn — as of VS-185/ADR 0024, `modelsFor(ctx)` is the one place that applies a
  filled daemon-level overlay on top of the workspace's own settings, and every call site (spawn,
  dispatch, the turn engine, session creation, the auth gate) goes through this same pair of functions —
  and writes the corrected `runtimeId` to both the DB row and the in-memory `agent` object *before* calling
  `ensureHomeCurrent()` a few lines later (the `prepare_home` phase). So by the time `ensureHomeCurrent`
  runs, `agent.runtimeId` already holds the right answer — it is simply never compared against what the
  marker recorded. VS-185 did not add any hook that re-renders an existing agent's home when a daemon
  overlay is set or cleared; that event flows into `ctx.config`/`ctx.daemon` and is only ever picked up the
  next time something calls `modelSettingFor(modelsFor(ctx), ...)`, which `ensureHomeCurrent` itself never
  does.

## Goals / Non-Goals

**Goals:**
- Make a runtime change (however it happened — a workspace's model settings changed, a ticket's
  `workerModelId` resolved differently, a config fix like VS-185) a first-class reason to re-render a
  worker's home, exactly like a brief or role-spec change already is.
- Make the fix self-healing for the three currently-live mis-provisioned workers without a hand-edit: their
  existing marker files predate the new field, so the first turn after this lands re-renders them.
- Pin the runtime→path and audience→kind mappings against `skills/manifest.json` in a test, so a future
  drift between the manifest and the hand-written `CONDUCTOR_SKILLS`/`WORKER_SKILLS` arrays or a runtime
  adapter's hardcoded `skillsDir` fails the suite instead of surfacing as another silent skill-load gap.

**Non-Goals:**
- Making `home.ts` read `skills/manifest.json` at runtime instead of the existing hardcoded
  `CONDUCTOR_SKILLS`/`WORKER_SKILLS` arrays and each adapter's hardcoded `skillsDir`. Those two are
  currently correct and consistent with the manifest; turning the manifest into the live source of truth
  is a larger refactor across five adapter packages that this bug does not require. The regression test
  (goal 3) is what keeps them honest instead.
- Deleting or cleaning up a stale skill copy left under a worker's previous runtime's path. Acceptance
  criterion 3 only requires the new path to be populated; leaving old copies behind is harmless (they are
  simply never read once the CLI resolves skills from its own runtime's directory).
- Anything about *why* a worker's resolved runtime changes (settings resolution, `modelSettingFor`
  precedence) — that is `engine.ts`'s existing, correct behavior and out of scope here.

## Decisions

### D1 — Track `runtimeId` on the render marker, treat a mismatch like a revision bump

Add `runtimeId: string` to the `Marker` interface and to what `currentRevisions()` returns. In
`ensureHomeCurrent()`, compute `runtimeChanged = !!marker && marker.runtimeId !== cur.runtimeId` alongside
the existing `briefUpdated`/`charterChanged`, and fold it into the same "does this need a re-render"
check. This is the smallest change that closes the gap: `renderHome()` itself already does the right thing
once it is called; the fix is entirely about not skipping that call.

Alternative considered: re-render unconditionally on every turn (drop the marker-based skip entirely).
Rejected — the skip exists to avoid rewriting `AGENTS.md`/skills on every single turn when nothing
changed, which is deliberate and unrelated to this bug; removing it would reintroduce needless disk I/O
and log noise for every turn of every live worker.

Alternative considered: read `agent.runtimeId` at the top of the `prepare_home` phase in `engine.ts` and
short-circuit into `renderHome()` directly, bypassing `ensureHomeCurrent()`'s own check. Rejected — it
would duplicate the "what forces a re-render" decision in two places (there is already `briefUpdated`/
`charterChanged` logic in `home.ts` that `engine.ts` does not know about); keeping one function own the
full decision is simpler and matches the existing shape.

### D2 — A marker written before this change is treated as "runtime unknown", which always mismatches

No migration step is needed: `readMarker()` already tolerates a missing field (`JSON.parse` just omits
it, so `marker.runtimeId` reads as `undefined`), and `undefined !== cur.runtimeId` is true for any real
runtime id. That means every currently-live worker's next turn re-renders its home once, unconditionally,
the first time this lands — which is exactly the "next spawn" self-healing the ticket's Notes section asks
for, except it happens on the next *turn* rather than requiring a fresh spawn.

### D3 — The regression test reads `skills/manifest.json` directly rather than hardcoding expected paths

The test asserts, for at least `claude` and `opencode`: (a) `skillsFor(ctx, 'worker')` returns exactly the
skills the manifest marks `worker`/`all` audience, and excludes every `conductor`-only one; (b) after
`renderHome()` with that runtime, each returned skill's directory exists under the path
`manifest.runtimes[<id>].path` resolves to (substituting the skill name for `<name>`). Reading the
manifest inside the test — rather than writing `.claude/skills` and `.opencode/skills` as literals — means
a future edit to `skills/manifest.json` that isn't mirrored in a runtime adapter's hardcoded `skillsDir`
fails this suite, which is the closest this change gets to the ticket's "read the manifest" framing without
the larger refactor D-non-goal above rules out.

## Risks / Trade-offs

- [A worker mid-turn when this deploys has already read its stale-runtime skills for that turn] →
  unavoidable and low-cost: the very next turn re-renders and the worker is caught up from then on: no
  worse than today, and self-limiting to at most one more affected turn per live worker.
- [Folding `runtimeChanged` into the same boolean the brief/charter checks use means the specific reason
  for a re-render isn't visible to the caller] → not needed by any consumer today (`engine.ts` only reads
  `briefUpdated`/`charterChanged` for prompt notes, and there is nothing a worker needs to be told about
  its own skill path); adding a fourth boolean the same shape as the existing two keeps parity if a future
  ticket wants to surface it.

## Migration Plan

No data migration and no new field to backfill: `Marker` is a small JSON file rewritten in full on every
render, and a missing `runtimeId` in an old marker already reads as "changed" (D2). Rollback is a plain
revert — a home rendered under the new code is a strict superset of what the old code would have written
(same files, same skills, just re-installed at the currently-correct path), so reverting loses nothing.

## Open Questions

None — the mechanism and its scope are decided above; nothing here would change the spec or task
breakdown if answered later.
