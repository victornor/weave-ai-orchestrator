## Context

See `proposal.md` — `Why`. This section only adds what's needed to follow the decision: how `sessionStale` and `AGENTS.md` re-rendering actually relate today, established by reading the code rather than assuming it, per the ticket's own instruction.

Three independent mechanisms interact:

1. `ensureHomeCurrent` (`packages/core/src/workers/home.ts`) re-renders a worker's `AGENTS.md` when `agent.briefRevision`, the role's `specRevision`, or the resolved `runtimeId` differ from the marker (`.ac-render.json`) it wrote at the last render. It never looks at knowledge content.
2. `sessions.forTurn` (`packages/core/src/sessions/index.ts`) marks a session `stale` in exactly two places: an idle-timeout check gated to `policy === 'persistent'`, and a runtime-mismatch check that applies to every policy. Both branches immediately replace the session with a brand-new one (`turnCount: 0`), so `stale: true` and `isFirstTurn: true` are always returned together — there is no code path today where a session is stale without also being a first turn.
3. `buildTurnPrompt` (`packages/core/src/prompts/index.ts`) pastes `bootstrapDigest` into the turn prompt when `isFirstTurn || sessionStale`, except that VS-161 excludes workers from that paste unconditionally, on the reasoning that `AGENTS.md` already inlines the same two hubs.

Worker roles default to, and in this workspace exclusively use, `sessionPolicy: 'per_ticket'` (`packages/shared/src/config.ts`'s zod default). For that policy, the only way `stale` becomes true is the runtime-mismatch branch. And a runtime mismatch is exactly one of the three conditions `ensureHomeCurrent` checks — so whenever a `per_ticket` worker's session goes stale, its `AGENTS.md` was re-rendered fresh in that same turn (the resolved runtime is written to `agent.runtimeId` before `prepare_home` runs, so `ensureHomeCurrent` sees the same mismatch `sessions.forTurn` sees later in the same turn). That is why VS-161's blanket exclusion has not visibly regressed anything: the one reachable stale-worker path always self-heals via a fresh render.

It holds by coincidence of `per_ticket` being the only policy in use, not because anything checks it. `sessionPolicy` is a per-role zod-validated enum (`packages/shared/src/enums.ts` `SESSION_POLICIES`) that already accepts `'persistent'` for any role, worker roles included. A worker role configured that way would go stale from idle time alone (`ctx.config.defaults.sessionMaxIdleDays`), with no brief/charter/runtime change and therefore no re-render — and would then, under the current unconditional exclusion, receive neither a fresh `AGENTS.md` nor the digest paste. That is the gap this change closes, without waiting for a worker role to actually adopt `persistent` before it can bite.

## Goals / Non-Goals

**Goals:**
- Close the unconditional worker exclusion so a stale session whose home was not just re-rendered still gets current knowledge, by pasting the digest.
- Keep the no-duplication guarantee for every case reachable today (stale-with-fresh-render, plain first turn).
- Leave the conductor's branch of `bootstrapDigest` and its prompt-paste condition untouched — same behavior, same tests.

**Non-Goals:**
- Not extending idle-based staleness detection to `per_ticket` sessions. Whether a long-idle worker session should be retired and replaced is a session-continuity decision independent of knowledge freshness, and out of scope here.
- Not adding a knowledge-revision-vs-agent tracking mechanism to catch knowledge edited mid-ticket with no runtime/brief/charter change and no session ever going stale. That is a real, separate gap (it predates VS-161 and is not specific to "stale sessions") and is not one of this ticket's acceptance criteria.

## Decisions

**Gate the worker exclusion on `homeRerendered`, not on `agent.kind` alone.** `ensureHomeCurrent` already computes `rerendered` (true whenever any of missing-file / brief / charter / runtime triggered a fresh render) and the run engine already discards it above `promptOptions`. Threading that one boolean through as `TurnPromptOptions.homeRerendered` and gating the exclusion as `agent.kind !== 'worker' || (opts.sessionStale && !opts.homeRerendered)` needs no new state, no migration, and produces exactly the three scenarios in the `worker-prompt/dedup` delta.

Alternative considered: gate on `!opts.isFirstTurn` instead of `!opts.homeRerendered`. Rejected — shown above, `sessionStale` and `isFirstTurn` are always equal today, so that gate would never fire; it would look like a fix without changing any reachable behavior. `homeRerendered` is the field that actually varies independently of `isFirstTurn` in the one case that matters (a hypothetical persistent-policy worker, idle-stale, no re-render).

Alternative considered: extend `ensureHomeCurrent` to also re-render when knowledge content changed. Rejected for this ticket — it's a bigger, separate fix (per Non-Goals above) for a gap that isn't about "stale sessions" and doesn't have an acceptance criterion here.

## Risks / Trade-offs

- [The new branch (stale-without-rerender) is unreachable with any worker role configured today] → Mitigated by testing it directly at the `buildTurnPrompt` unit level (passing the option combination explicitly), the same way the existing VS-161 tests exercise `isFirstTurn`/`sessionStale` combinations that the engine may or may not currently produce end-to-end.
- [`homeRerendered` could be mis-threaded and silently stay `undefined`] → `!opts.homeRerendered` treats `undefined` the same as `false` (paste the digest), which is the safe default: a missing signal errs toward "assume the home might be stale," not toward silently withholding current knowledge.
