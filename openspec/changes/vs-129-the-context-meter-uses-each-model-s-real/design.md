## Context

See `proposal.md` for the motivation. This document records what each Claude Code model's real
context window is, where that number came from, and why the fix also has to change how `contextStrip`
treats a measurement that contradicts the declared window — because the same class of bug (a stale
per-model constant) will recur, and next time it should not read as a false 100%.

The role's operating rules forbid launching the real `claude` CLI from inside a ticket, live or
otherwise — even read-only — because the daemon shares one OAuth credential per runtime per host and
refresh rotates the token on every use. No CLI was executed to produce this document. Everything
below came from **static analysis of the installed CLI binary's own bytes** (`strings` and a direct
byte-offset read), the same "discover the CLI's behaviour via `strings`" method already used
elsewhere in this repo's test fixtures for adapter development. No process was spawned, no network
call was made, no credential was touched.

## Goals / Non-Goals

**Goals:**
- State, per model id in `packages/runtimes/claude/src/adapter.ts`'s table, its real context window
  and the evidence for it.
- Make the meter's reaction to a wrong declaration (measured size > declared window) an honest
  "the declaration is wrong" signal instead of a silent clamp to 100%, so the next drift is visible
  rather than repeating this incident.

**Non-Goals:**
- Querying the model window from the runtime dynamically at detection time. Investigated (see
  Decisions) and not achievable without invoking the CLI, which this role may not do.
- Any change to how `contextTokens` is measured, to compaction behaviour, or to the Gemini/OpenCode/
  Codex adapters (confirmed unaffected — see Decisions).

## Decisions

### What each model's context window actually is, and how that was established

`packages/runtimes/claude/src/adapter.ts`'s `MODELS` table carries eight entries: the four bare
aliases (`fable`, `opus`, `sonnet`, `haiku`) and four pinned ids (`claude-fable-5-1`,
`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`). The installed CLI
(`/home/user/.local/share/mise/installs/claude/2.1.258/claude`, version 2.1.258) embeds a comment
literally calling itself the source of truth:

> "Hand-maintained baked-in model catalog — the source of truth for per-model provider IDs and
> metadata. On model launch add one entry to `models` below; `bun run generate:model-catalog`
> validates this file against the schema and formats it."

That catalog (a JS object literal, `R8t`, found at a fixed byte offset via
`grep -aoE`/direct byte read, not by running the binary) lists, per model id, a `context.window`
field. The entries this table's ids resolve to:

| adapter id (or the alias it names) | catalog id it resolves to | catalog `context.window` |
|---|---|---|
| `haiku` | `claude-haiku-4-5` (alias default) | `200000` |
| `claude-haiku-4-5-20251001` | `claude-haiku-4-5` (exact `provider_ids.first_party` match) | `200000` |
| `sonnet` | `claude-sonnet-5` (alias default) | `1e6` (native, not a beta flag) |
| `claude-sonnet-5` | `claude-sonnet-5` (exact id match) | `1e6` |
| `opus` | `claude-opus-5` (alias default) | `1e6` (native) |
| `claude-opus-5` | `claude-opus-5` (exact id match) | `1e6` |
| `fable` | `claude-fable-5-1` (alias default) | `1e6` (native) |
| `claude-fable-5-1` | `claude-fable-5-1` (exact id match) | `1e6` |

The catalog's own `aliases` map confirms the alias resolution used above:
`{opus:{default:"claude-opus-5",...}, sonnet:{default:"claude-sonnet-5",...}, haiku:{default:
"claude-haiku-4-5"}, fable:{default:"claude-fable-5-1",...}}`, matching `latest_per_family`.

This directly explains the incident: `claude-sonnet-5`/`claude-opus-5`/`claude-fable-5-1` carry
`native_1m:true` — their base window already is 1,000,000 tokens, no beta opt-in needed — while the
adapter declared 200,000 for every entry including these. A session on any of the three natively-1M
models legitimately reaching ~370k tokens divided by 200,000 is exactly the impossible 186% (clamped
to 100%) captain saw. Haiku genuinely is 200,000 — that entry does not change.

The catalog also carries the older, non-native models the adapter does **not** list
(`claude-sonnet-4-6`, `claude-opus-4-7`, etc.), each with `context.window:200000` plus
`supports_1m_beta`/`supports_1m_suffix` flags and a **separate** `<id>[1m]` catalog id for the
extended-context variant — the exact shape `adapter.ts`'s existing comment anticipated ("a variant
with a larger window is its own entry"). None of those ids are in our table, so none of this affects
the fix; it is recorded here only as confirmation that the `[1m]`-suffix pattern is real, not a
hypothetical, for the day a `-4-x` id is added to the table.

**Confidence**: this is not a guess and not a hardcoded replacement for one wrong constant — it is
the CLI's own declared, hand-maintained catalog, version-pinned to the CLI build actually installed.
The one caveat: the CLI can also fetch a **served/published catalog** over the network at runtime
(`https://downloads.claude.ai/model-catalog/v1/catalog.json`) which can override entries when
reachable — the baked-in catalog above is the CLI's own fallback, used when that fetch is
unavailable or the served catalog agrees. No live fetch was made or could be made under this role's
rules, so the possibility of the served catalog stating something different for these specific ids,
right now, cannot be ruled out from inside this ticket. That risk is exactly why the second decision
below (treat over-window as anomalous, not clamp) matters independently of getting today's numbers
right.

### Other runtime adapters do not share this bug

`packages/runtimes/gemini/src/adapter.ts`, `packages/runtimes/codex/src/adapter.ts` and
`packages/runtimes/opencode/src/adapter.ts` were grepped for `contextWindowTokens` /
`CONTEXT_WINDOW`: none of their `MODELS`/`FALLBACK_MODELS` entries set the field at all. `resolveModel`
returning a model with `contextWindowTokens: undefined` already yields `contextStrip`'s "Context
window unknown" reason (no percentage drawn) — the honest state, not a wrong one. Those adapters
need no change for this ticket; they never asserted a number to begin with, they simply have not
been extended to report one yet, which is a separate, future capability rather than a defect.

### Over-window is now shown uncapped, not clamped to 100%

`contextStrip` (`packages/render/src/usage.ts`) currently computes `percent`/`toCompaction` with
`Math.min(100, ...)`. Removing only the upper bound (keeping the `Math.max(0, ...)` floor) is the
whole change: when `tokens <= window`, behaviour is identical to today. When `tokens > window`, the
percentage is now the true, uncapped figure (e.g. 250% for 500k against a 200k window) rather than a
value indistinguishable from a context that has genuinely filled its window at exactly 100%.

`ContextMeter.tsx`'s bar cannot be drawn past its own track regardless: it separately clamps only the
CSS `width` (`Math.min(100, view.meter.percent)`) while the percentage text and the tone (`limitTone`
already treats anything ≥95% as `'over'`, so no new tone is needed) keep using the true number. This
was chosen over adding a new `overWindow` boolean/tone: the uncapped number is self-evidently
anomalous (a context cannot really be "250% full"), which already satisfies the acceptance
criterion's "at minimum visible as anomalous," without a second code path or a fourth tone to keep in
sync with the plan-limit bars' existing `ok`/`warn`/`over` scheme.

**Alternative considered**: fall back to a `reason`-only render (no meter at all) when
`tokens > window`, on the theory that a contradicted declaration is as untrustworthy as a missing
one. Rejected — collapsing "the window is stated but evidently wrong" into the same quiet line as
"the window was never stated" throws away the one piece of information that would help someone debug
it (that there is a number, and it disagrees with reality), and it stops showing the compaction
distance too, which is still meaningful even against a wrong denominator.

## Risks / Trade-offs

- The corrected constants are only as current as CLI 2.1.258's baked-in catalog. A future CLI update
  could ship different numbers for these ids → the uncapped-percentage change is exactly the
  mitigation: the next drift shows up as a visibly impossible percentage instead of a silent, correct-
  looking 100%.
- Removing the upper clamp means a caller relying on `percent`/`toCompaction` always being ≤100 (e.g.
  for a CSS width) will overflow if it uses the raw view-model value directly instead of clamping at
  the point it draws a fixed-size bar. Mitigated by making that clamp `ContextMeter.tsx`'s job
  explicitly, and it is the only current consumer of `contextStrip` in the web app (checked via
  `contextStrip` grep — `packages/tui`/`packages/render` do not currently render this specific strip
  elsewhere).

## Open Questions

None — the alternative catalog source (the network-served one) is a known, disclosed limitation of
this evidence, not a deferrable unknown that would change the approach: the uncapped-percentage
requirement is unconditionally correct regardless of which catalog is right today.
