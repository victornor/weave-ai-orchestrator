## Why

VS-34 taught the daemon to describe each runtime's account — subscription or API key, plan label,
limit windows with utilisation and reset time — and refresh that snapshot every five minutes; VS-73
fixed the probe's launch so the snapshot for a subscription actually arrives. Everything the number
needs is already in `runtime_accounts`, already rendered by `accountLimits()` in `packages/render`.

But it is only readable on the Usage page, one navigation away from where the spending happens. The
workspace owner is in the conductor chat: that is where a turn is started, and where finding out
that the session window is nearly spent — or that it resets in ten minutes and the work can wait —
changes what they do next. Today they find out by running out.

## What Changes

- **The conductor chat header carries a live plan meter** when the conductor's runtime is on a
  subscription: the session window's utilisation as a percentage with a small bar, and the bare
  time left before it resets (`Session 33% · 2h 10m`).
- **The weekly and per-model windows are one tap away**, in a sheet, rather than in the header.
  Hover carries the runtime, the plan label and the capture time, so a stale snapshot looks stale.
- **The countdown ticks locally between refreshes**, and the snapshot is re-read on the daemon's
  own five-minute probe cadence. Nothing emits a workspace event when a snapshot is replaced, so
  the strip polls rather than subscribes; polling faster would only re-read a row nothing rewrote.
- **A metered account, an unprobed runtime and a runtime with no snapshot show nothing at all.** An
  API key has no window to be a fraction of, and a bar at zero would be a lie about a plan that does
  not exist. A subscription whose limits are unavailable, and an account the probe could not
  describe, get one quiet line — `Limits unavailable` / `Account probe failed` — and no number.
- **The meter is about the conductor's runtime specifically**, read from the conductor agent's own
  `runtimeId`, which `ensureConductor` keeps in step with the `conductor` block of the workspace
  config and which the Settings screen already reads. One source, not two.

- **The same header strip also meters the conductor's context** (scope addition from the workspace
  owner, 2026-09-07 10:01): how full the context window is, and how far that is towards the point
  the runtime compacts at (`Context 41% · 45% to compaction`), with the token count on hover. The
  size is the last finished turn's `inputTokens + cachedInputTokens` — the conductor's session is
  resumed, so everything the conversation holds is re-sent or read from cache every turn — and it
  refreshes because `run.finished` now invalidates the conductor detail.
- **The context window and the compaction point are the runtime's, not the UI's.** `RuntimeModel`
  gains `contextWindowTokens` and `RuntimeCapabilities` gains `contextCompactionAt`; the Claude
  adapter fills both, and a model whose window is not in the runtime's list, or a turn that reported
  no tokens, gets a quiet reason rather than a percentage of a number we invented.

## Capabilities

### New Capabilities

- `conductor-chat/session-limit`: what the conductor chat header shows about the plan behind the
  conductor's runtime and about its context window — the session meter, the countdown, the context
  meter and its distance to compaction, the detail behind them, and the cases where each shows a
  quiet reason or nothing at all.

## Impact

- `packages/runtime-sdk/src/index.ts` — `RuntimeModel.contextWindowTokens` and
  `RuntimeCapabilities.contextCompactionAt`, both optional.
- `packages/runtimes/claude/src/adapter.ts` — `CONTEXT_COMPACTION_AT` (0.92) and the 200k window on
  every model entry. The compaction point is a constant we maintain: Claude Code does not report it
  over the wire, and the comment on it says so.
- `packages/render/src/format.ts` — `formatCountdown`, the bare `2h 10m` a header ticks.
- `packages/render/src/{types,usage}.ts` — `RuntimeLimitStripView` and `runtimeLimitStrip()`, over
  the same `RuntimeAccount` snapshots `accountLimits()` already reads.
- `packages/ui/src/components/SessionLimit.tsx` — the plan strip, its local clock and its detail sheet.
- `packages/ui/src/components/ContextMeter.tsx` — the context meter beside it.
- `packages/render/src/{types,usage}.ts` — `ContextStripView`, `contextStrip()`, `contextTokens()`
  and `resolveModel()` (exact id, then the longest entry a reported build id starts with).
- `packages/ui/src/api/events.ts` — `run.started`/`run.finished` invalidate the conductor detail.
- `packages/ui/src/api/hooks.ts` — `ACCOUNTS_REFRESH_MS` and an opt-in refetch interval on
  `useUsageAccounts`, so only a screen that wants live numbers pays for the poll.
- `packages/ui/src/routes/Chat.tsx` — the strip in the page header; the worker/decision meta is
  desktop-only so the header stays one line on a phone.
- Tests: `packages/render/src/{format,usage}.test.ts`,
  `packages/ui/src/test/{sessionLimit,contextMeter,chat,events}.test.tsx`.

## Out of scope

- Alerting when the limit or the compaction point is near.
- Context windows for the codex, gemini and opencode adapters: none is stated here, so the meter
  says the window is unknown for them rather than carrying a number nobody verified.
- The probe, the snapshot store and the Usage page, all unchanged.
- Worker runtimes: the header is about the conductor's own plan.
- The terminal chat (`packages/tui/`) and the Telegram channel.
