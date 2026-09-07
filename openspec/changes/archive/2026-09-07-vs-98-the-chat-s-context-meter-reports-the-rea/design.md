## Context

See proposal.md — Why. The mechanics that constrain the design:

- The Claude CLI's `assistant` messages each carry `message.usage` for the request that produced
  them; the terminal `result` message carries the same fields summed over the turn's requests, plus
  an `iterations` array of the per-request blocks. Verified against the recorded fixtures
  `packages/runtimes/claude/fixtures/*.jsonl` (claude 2.1.258, 2026-09-03).
- `finalize()` (`packages/core/src/runs/engine.ts:336`) writes `usageJson: usage` — the whole
  `TurnResult.usage` object — into `runs.usage_json`, a JSON column. Every other consumer of that
  object (`sessions.record`, `recordUsage`, `estimateCostCents`) picks its fields by name.
  A new key therefore reaches `Run['usage']`, `GET /conductor`'s `lastRun` and the chat with no
  migration, no route change and no engine change.
- `contextStrip()` is pure and lives in `packages/render`; `Chat.tsx` hands it `lastRun.usage`
  wholesale. The UI needs no new hook or query.

## Goals / Non-Goals

**Goals:**

- One field carries one meaning: a per-request context size that is never a sum, alongside the
  cumulative counts that stay exactly as they are.
- A runtime that cannot report per request produces *no* number, not a wrong one.
- The fix is provable from a recorded fixture rather than from a live CLI run.

**Non-Goals:**

- Per-request usage for Codex, Gemini or OpenCode (see proposal — Out of scope).
- Making the meter live during a turn. It still recomputes when a turn finishes.
- A capability flag describing per-request reporting.

## Decisions

**A single `contextTokens?: number` on `TurnResult.usage`, not a second usage object.**
The meter needs one number: the request's input + cache-creation + cache-read tokens. The adapter
already holds all three and is the only place that knows how they compose for its CLI, so it sums
them once and hands over the answer. A nested `lastRequest: { inputTokens, cachedInputTokens }`
would push that arithmetic into `packages/render`, where it is exactly the arithmetic that produced
the bug. Optional, so an adapter that cannot state it omits it rather than reporting a zero — the
same discipline `RuntimeModel.contextWindowTokens` and `RuntimeCapabilities.contextCompactionAt`
already follow.

**Presence of the field is the signal, not a capability flag.**
`usageReporting: 'per_turn'` is already declared by all four adapters and describes the cumulative
figure, so it cannot double as "reports per request". Adding a fifth capability to say what the
absence of a field already says would give two sources for one fact and let them disagree. An
absent `contextTokens` reaches `contextStrip` as 0, which is the existing "Context size unreported"
path — no new branch in the meter.

**Read it from the `assistant` messages, not from `result.iterations`.**
`iterations` is undocumented, and in `turn-tool-structured` it holds a single entry for a turn that
made two requests — it is not a reliable list of the turn's requests. The `assistant` messages are the stream the parser already walks; each one's usage
is the request that produced it, and keeping the last one seen needs three lines in a function that
is already parsing that message. If the CLI ever stops attaching usage there, the field is absent
and the meter says so, which is the correct degradation.

**Ignore `assistant` messages with a non-null `parent_tool_use_id`.**
Those are a sub-agent's messages. Their request measures the sub-agent's conversation, not the one
the window belongs to, and a turn that ends inside sub-agent work would otherwise report the
sub-agent's much smaller context as the conductor's. The envelope carries the field on every
`assistant` message (null on the main thread) in both fixtures.

**Last wins, not maximum.**
The meter answers "how full is the conversation now", and the conversation only grows within a turn,
so the last request is also the largest under normal operation. Taking a maximum would hide a
compaction that the runtime performed mid-turn — precisely the event the meter exists to anticipate.

**`contextTokens()` in `packages/render` keeps its name and changes its body.**
It is exported and tested but has exactly one caller, `contextStrip`. Renaming it would churn the
tests without making anything clearer; what changes is what it reads, which its doc comment states.

## Risks / Trade-offs

- **Three of four runtimes lose their context meter** (they show "Context size unreported" instead of
  a number). → The number they show today is wrong by a factor of the turn's request count, so this
  is a correction, not a regression; the line it falls back to already exists and is already
  specified. Per-runtime work to restore it is named in the proposal as out of scope.
- **A turn whose last `assistant` message carries no usage records nothing** → the meter says
  "Context size unreported" for that turn only, and the next finished turn replaces it. No fallback
  to the cumulative figure: falling back would silently reintroduce the bug for the case we cannot
  see.
- **Runs recorded before this change have no `contextTokens`** → their meters read "Context size
  unreported" until the conductor next finishes a turn. Acceptable, and better than the 100% they
  read now. No backfill is possible: the per-request figure was never recorded.
- **The fix is verified against recorded fixtures, not a live CLI.** → Running the real `claude`
  binary from a worktree rotates the shared credential and signs every agent out (2026-09-07
  outage), so it is not done here. The fixtures are recorded live output of the exact stream shape
  being parsed, and the multi-request assertion is derived from them.

## Migration Plan

No schema change, no data migration, no config. `runs.usage_json` gains a key on new rows; old rows
parse unchanged and read as "unreported". Rollback is reverting the commits — nothing written while
the change was live is invalid afterwards, since every consumer reads the usage object by name.

Deploying is the owner's `conductor daemon upgrade` after the merge, as always.
