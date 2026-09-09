## Context

See `proposal.md` — Why. Mechanics that constrain the design:

- OpenCode's `opencode run --format json` stream (verified against fixtures recorded from
  opencode 1.18.27 on 2026-09-03) emits one `step_finish` per API request. `part.tokens` is
  `{ total, input, output, reasoning, cache: { write, read } }`. `tokens.total` includes
  output (e.g. simple turn: total 11824 = input 10018 + output 14 + cache.read 1792), so it is
  not a context size.
- Claude's `contextTokens` (`packages/runtimes/claude/src/events.ts:93-94`) is
  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` — output excluded.
  OpenCode's equivalent is `tokens.input + tokens.cache.write + tokens.cache.read`.
- `finalize()` writes `TurnResult.usage` whole into `runs.usage_json`. `contextStrip` reads
  only `usage.contextTokens`. An absent field is already "Context size unreported". No
  engine, route, render or UI change is required once the adapter sets the field.
- The credential rule forbids launching the real OpenCode CLI from a worktree. The existing
  fixtures are recorded live output of the stream being parsed.

## Goals / Non-Goals

**Goals:**

- OpenCode turns that reported per-request tokens record last-request `contextTokens`, same
  definition as Claude / `TurnResult.usage.contextTokens`.
- Cumulative totals stay the turn's cost figure, never a size.
- A stream with no `tokens` object omits the field.

**Non-Goals:**

- Gemini, Codex, Cursor.
- Changing `contextStrip`, Chat.tsx, or Claude.
- Declaring OpenCode `contextWindowTokens` (separate; VS-129).
- Making the meter live during a turn.
- Changing how cumulative `usage` treats `cache.write` (today only `cache.read` is summed into
  `cachedInputTokens`).

## Decisions

**Read it from `step_finish.part.tokens`, last wins.** Each `step_finish` is one request.
Keeping the last one seen is the same rule Claude uses on `assistant` messages. Taking a
maximum would hide a mid-turn compaction; summing would reintroduce VS-98. The
`turn-tool-report` fixture is the proof: step 1 is 4,294 + 0 + 7,424 = 11,718; step 2 is
257 + 0 + 11,520 = 11,777; cumulative input+cache-read is 23,495. `contextTokens` must be
11,777.

**Sum `input + cache.write + cache.read`, never `tokens.total`.** Matches Claude's three-term
definition. `total` includes output (and reasoning). Fixtures have `cache.write: 0`, so
existing cumulative assertions do not move; the formula still includes write so a future
non-zero write is counted as cache creation, not dropped.

**Presence of a `tokens` object is the signal, not a capability flag.** Same discipline as
VS-98: omit the field when `sawTokens` is false (`turn-error.jsonl`). Do not fall back to
the cumulative totals. A tokens object whose fields are all zero may record `contextTokens: 0`,
which `contextStrip` already treats as unreported.

**Forward on the adapter exactly as Claude does.**
`usage: { ...st.usage, ...(st.contextTokens != null ? { contextTokens: st.contextTokens } : {}), basis: 'per_turn' }`.
Only when `st.usage` is present, so a no-tokens turn still has no usage object.

**No OpenCode analogue of Claude's `parent_tool_use_id` skip.** The recorded stream has no
nested sub-agent envelope on `step_finish`. Do not invent a filter the CLI does not emit.

## Risks / Trade-offs

- **OpenCode models still declare no `contextWindowTokens`.** A known size with an unknown
  window is already specified: the header shows the headline count with no bar. Restoring
  the window is separate work (VS-129 left OpenCode omitted). After this change the meter
  stops saying "unreported" and starts showing the count — which is the ticket.
- **Verified against fixtures, not a live CLI.** Same constraint as VS-98. If a later
  OpenCode build stops putting `tokens` on `step_finish`, the field is absent and the meter
  says so.
- **Cumulative `usage` still ignores `cache.write`.** Out of scope. `contextTokens` includes
  it so the size matches Claude's definition even if the cost totals do not.

## Migration Plan

No schema change, no data migration, no config. New OpenCode runs gain a key on
`runs.usage_json`; old rows stay "unreported" until the next finished turn. Rollback is
reverting the commits. Deploy is the owner's `conductor daemon upgrade` after the merge.
