## Context

See `proposal.md` - Why. Two facts from investigating the current code shape this design:

- `Run.model` and `Run.usage` (`packages/shared/src/types.ts`) are already stored on every run row
  (`runs.model`, `runs.usage_json`), written by the run engine (`packages/core/src/runs/engine.ts`)
  for every runtime, including one (Cursor, `usageReporting: 'none'`) that never sets `usage` at
  all — for that runtime `Run.usage` is the JSON value `null`, not an omitted key or a zeroed object.
- `RunTrace` (`packages/shared/src/types.ts`), the aggregate `RunsService.traces()` computes and the
  chat's history already fetches for the "what I did" line, does not carry either field today — it
  is a narrower, purpose-built projection of `runs` plus a `run_events` count aggregate. Both the
  work-trace line and the per-message token count need is already in `runs`; nothing needs new
  collection, only exposing two existing columns through this one existing aggregate.

Context-window usage (as opposed to tokens spent) is already computed for exactly one place in the
app: the chat header's `ContextMeter`, from `lastRun` (the conductor's single most recent turn) via
`contextStrip()` and `resolveModel()` (`packages/render/src/usage.ts`). That computation needs a
run's `model` and `usage.contextTokens` plus the runtime's model catalog (for the window) and
capabilities (for the compaction point) — the same two `RunTrace` fields, plus data the chat route
already fetches for the header and can pass down.

## Goals / Non-Goals

**Goals:**
- Tokens spent, in the work-trace line and next to each message's timestamp, for every turn a
  runtime reported usage for.
- Context-window usage in the work-trace line, reusing the exact computation (`contextStrip`) and
  representation the header meter already uses, for every turn whose model and context size are
  both resolvable — not just the latest one.
- Clean degradation, asserted by tests: a runtime reporting no usage (Cursor today) renders with
  the new figures simply absent.

**Non-Goals:**
- No new usage collection, no runtime/adapter change, no new migration or column.
- No change to the ticket pages, the run transcript, or the usage dashard — each already shows its
  own token/usage figures; this is conductor chat only.
- No context-window figure for a message's timestamp — the ticket only asks for a token count there.

## Decisions

**Extend `RunTrace` rather than add a second endpoint.** `RunTrace` gains `model: string | null` and
`usage: Run['usage']`. `RunsService.traces()` selects the two extra columns (`model`, `usage_json` —
already on `runs`) alongside the columns it already selects, and the mapper copies them through. No
new SQL query, no new route: `GET /runs/traces` already returns whatever `traces()` returns.
Alternative considered: a second endpoint / a `?include=usage` flag on `GET /runs/traces`, rejected
as unneeded ceremony — nothing about `model`/`usage` is expensive to select or sensitive to expose,
and every caller of `traces()` benefits from having them.

**Reuse `contextStrip()`/`resolveModel()`, not `budgetMeter()`.** The ticket's own text points at
`budgetMeter` as "the existing pattern for how much of a budget is used", but `budgetMeter` is a
generic `estimate / manually-set-budget` meter used for the knowledge-base token budget line — a
different quantity with no notion of a model's context window. `contextStrip()` is the function
that already computes *this exact* quantity (a turn's last-request context size over its model's
context window) for the header meter. Reusing it, rather than `budgetMeter`, is "match the existing
formatting rather than introducing a second style for the same quantity" applied to the thing the
ticket actually asked for.

**Show the context figure as a size-over-window fraction (`82k/200k ctx`), never a bare percentage.**
The header `ContextMeter` deliberately shows the raw context size as its headline rather than a
percentage of the window, because a percentage implies the window figure is trustworthy — VS-129
found the window constant wrong for 6 of 8 Claude models, and a size that reads over 100% of a wrong
window is itself the evidence something is off, not a number to hide by clamping it (see
`contextStrip`'s own comment, `packages/render/src/usage.ts:271-274`). A trace line has no room for
the header's two-part treatment (headline size + a compaction-percentage aside), so it shows the
compact fraction the size and the window both already have (`contextStrip().tokensLabel` and
`.windowLabel`) rather than `meter.percent` alone. This keeps the "a percentage of a possibly-wrong
number is misleading" lesson from VS-129 rather than reintroducing it in a new place.

**Resolve each trace's own model against the runtime's *current* model catalog.** A historical run's
`model` is looked up in `conductorModels.data` (`useRuntimeModels(conductorRuntime)`), the same
catalog the header already fetches once per render of the chat route — not a new fetch per trace.
This assumes a model id's context window doesn't change retroactively for the conductor's own
runtime, which holds in practice (a model catalog entry's window is a property of the model, not of
when it was queried). If the model has since been removed from the catalog, `resolveModel()` returns
`null` and the trace shows tokens with no context fraction — the same "tokens known, window not"
degradation the spec already requires.

**Per-message tokens come from the same `RunTrace` the message already correlates with, not a new
join.** `chatRows()` (`packages/ui/src/lib/dispatch.ts`) already pairs each message with the trace of
its own `runId`. `ChatMessage` takes that trace's `usage` as a prop and shows its total
(`inputTokens + outputTokens`, the same total shown elsewhere in the app) next to the timestamp.
Because `chatRows()` nulls out a message's paired trace when the trace is otherwise empty
(`traceIsEmpty`, e.g. a turn with no tool calls, no files, no assistant text, no errors), a message
from such a turn will show no token count either, even if the run did record usage — an existing
asymmetry between "trace worth a line" and "usage worth a number" that this change does not
resolve, since a message with a trace suppressed for emptiness practically never happens (a message
implies at least one `assistant.text` event).

**Formatting: `packages/ui/src/lib/format.ts`'s `tokens()`, not `@agent-conductor/render`'s
`formatTokens`.** Both produce the same `940 / 18.4k / 1.2M` convention, but every other raw token
number already rendered in `packages/ui` (Runs, RunPage, WorkerCard, TicketCard, TicketPage, Usage,
WorkerPage) goes through the local `tokens()` helper; render's `formatTokens` is only ever consumed
indirectly, baked into render's own already-formatted view-model strings. `TurnTrace.tsx` and
`Chat.tsx` both already import `clock`/`duration` from the same local file, so `tokens` joins that
same import rather than adding a new dependency edge to `@agent-conductor/render` for a formatting
call `packages/ui` doesn't otherwise make directly.

**Mobile width: rely on the existing `ac-truncate` line, add no new flex child to the timestamp
row.** The work-trace line's label is already one `ac-truncate` span (`overflow: hidden; ellipsis;
nowrap`) built by joining an array with `' · '` — appending two more optional entries to that same
array cannot wrap the line; at most it truncates sooner. The message timestamp row has no such
truncation today; the new token span there is kept to the same compact form (`1.2k tok`) as the
existing project-tag and Reply affordances already share that row, rather than introducing a new
wrapping risk. This is checked in the browser (`ui-screenshot-harness`) as part of delivery, per the
project's own rule that a visual claim needs a look, not just a passing test.

## Risks / Trade-offs

- [A trace's own model may not resolve against the current model catalog if a model id is retired] →
  degrades to "tokens shown, context omitted," which is already a required, tested scenario — not a
  new failure mode.
- [The message-level token count can go missing for a turn whose trace was nulled for emptiness,
  even though usage was recorded] → accepted: such a turn practically cannot have produced a message
  (a message requires at least one `assistant.text` event, which alone makes `traceIsEmpty` false).
- [Two near-identical token-formatting helpers now clearly duplicate the same convention across
  `packages/render` and `packages/ui`] → pre-existing, not introduced by this change; noted rather
  than fixed, since merging them is an unrelated cleanup with its own blast radius.

## Migration Plan

No migration: `runs.model` and `runs.usage_json` already exist and are populated for every run past
and future. Deploying this is a code-only rollout; a rollback simply reverts the code, and every
existing run's data is unaffected either way.
