## Why

`packages/runtimes/claude/src/adapter.ts` declares `contextWindowTokens: 200_000` for every entry
in its model table — Fable, Opus, Sonnet, Haiku, latest and pinned alike. That was true once but is
no longer: static analysis of the installed Claude Code CLI's own baked-in model catalog (see
`design.md`) shows the `sonnet`/`opus`/`fable` aliases and their pinned `-5`/`-5-1` ids now resolve
to natively 1M-token models, while only Haiku stays at 200k. A conductor session on one of those
models legitimately reaches ~370k tokens; divided by the wrong 200k constant that reads as 186%,
clamped to a confident, wrong 100% — captain acted on that reading twice believing a compaction was
imminent when it was not. Fixing the declared numbers removes today's false alarm, but the same
class of bug (the adapter asserting a window a request's size then contradicts) will recur the next
time a model's window changes and the constant is not updated with it, so the meter also needs to
stop treating "measured size exceeds the declared window" as "the context is full" and start
treating it as "the declaration is wrong."

## What Changes

- Correct `packages/runtimes/claude/src/adapter.ts`'s per-model `contextWindowTokens`: 1,000,000 for
  every entry that resolves to a natively 1M-context model (`fable`, `opus`, `sonnet` and their
  pinned `-5`/`-5-1` ids), 200,000 unchanged for the two Haiku entries. Evidence and method recorded
  in `design.md`, cited by model id, not guessed.
- `contextStrip` (`packages/render/src/usage.ts`) stops clamping `meter.percent` and
  `meter.toCompaction` to 100 when the measured size exceeds the declared window: it reports the
  true, uncapped percentage instead, so an impossible reading (a context "over 100% full") is
  visibly anomalous rather than indistinguishable from a context that has genuinely filled its
  window at exactly 100%.
- `ContextMeter` (`packages/ui/src/components/ContextMeter.tsx`) leads with the raw token count
  (`view.tokensLabel`) instead of a percentage of the window — a percentage is only as trustworthy
  as its denominator, and that denominator has been wrong twice. The bar carries the proportion
  visually (capped at its own edge); the only percentage left in words is the distance to
  compaction, which stays uncapped so an over-window reading is still visibly anomalous there.
  When the window is unknown but the size is known, the header shows the bare count rather than
  only the quiet "window unknown" line. Added per captain's review of the first version of this PR
  (ticket comment, 2026-09-08).
- No change to how context size is measured (VS-98), to compaction behaviour, or to the
  already-correct "window unknown" path (`resolveModel` returning `null` already yields the "Context
  window unknown" reason with no invented percentage — unaffected by this change).
- Gemini, OpenCode and Codex adapters are confirmed to declare no `contextWindowTokens` at all today
  (see `design.md`), so their meters already read "unknown" rather than a wrong number; nothing in
  those adapters needs to change to satisfy this ticket.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/session-limit`: the context-meter requirement's "cannot exceed 100%" scenario is
  corrected, and a new requirement is added: a context measured larger than its declared window is
  shown as an uncapped, anomalous percentage rather than clamped to 100%.

## Impact

- `packages/runtimes/claude/src/adapter.ts` — corrected per-model `contextWindowTokens` values.
- `packages/render/src/usage.ts` (+ `packages/render/src/types.ts` doc comments) — `contextStrip`
  no longer upper-clamps `percent`/`toCompaction`.
- `packages/ui/src/components/ContextMeter.tsx` — bar width clamped separately from the displayed
  percentage.
- Tests: `packages/runtimes/claude/test/adapter.test.ts`, `packages/render/src/usage.test.ts`,
  `packages/ui/src/test/contextMeter.test.tsx`.
- No DB migration, no API surface change, no change to how `contextTokens` is measured or reported.
