## Why

VS-161 already stopped the literal first-turn duplication this ticket describes: `buildTurnPrompt` no longer pastes the `bootstrapDigest` (SHARED.md + PROJECT.md) into a worker's turn prompt on `isFirstTurn`, because the worker's `AGENTS.md` already inlines both hubs. `worker-prompt/dedup`'s "Worker first-turn prompt does not re-paste inlined knowledge hubs" requirement already encodes exactly that, and its own text also blocks the paste "on a stale session" — unconditionally, for every worker, regardless of whether that worker's `AGENTS.md` was actually refreshed this turn.

That blanket exclusion is the real gap. `ensureHomeCurrent` only re-renders `AGENTS.md` when the agent's brief revision, role charter revision, or resolved runtime changed — never because a knowledge hub's content changed. For the one live worker session-policy (`per_ticket`), a session is only ever marked `stale` by a runtime change, and that always re-renders the home in the same turn, so today's blanket suppression happens to be safe. But it holds by coincidence of the current session-policy default, not by anything that checks it — a worker role configured with the `persistent` policy (the schema already allows it) would go stale from idle time alone with no re-render, and would then get neither a fresh `AGENTS.md` nor the digest: current knowledge would never reach it.

## What Changes

- `buildTurnPrompt`'s worker-exclusion for the bootstrap digest becomes conditional on whether the worker's home was actually re-rendered this turn, not on the worker's kind alone: a stale session that got a fresh render (today's only reachable case) still skips the digest paste (no duplication); a stale session that did **not** get a fresh render now receives the digest, so current knowledge always reaches a stale worker one way or the other.
- `ensureHomeCurrent`'s `rerendered` result (already computed, currently discarded above the run engine) is threaded through `promptOptions` as `homeRerendered` so `buildTurnPrompt` can make that call.
- The conductor's branch of `bootstrapDigest` and its unconditional first-turn/stale-session paste are untouched.
- `templates/brief.md.tmpl`'s "already injected" wording is tightened to say what actually happens: inlined in `AGENTS.md` at render time, refreshed rather than re-pasted on a stale session.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `worker-prompt/dedup`: the "Worker first-turn prompt does not re-paste inlined knowledge hubs" requirement changes from an unconditional stale-session exclusion to one gated on whether the home was refreshed this turn.

## Impact

- `packages/core/src/prompts/index.ts` (`TurnPromptOptions`, `buildTurnPrompt`)
- `packages/core/src/runs/engine.ts` (forwards `ensureHomeCurrent`'s `rerendered` flag)
- `templates/brief.md.tmpl` (wording)
- Tests: `packages/core/src/prompts/render.test.ts`
