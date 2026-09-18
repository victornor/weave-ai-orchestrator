## Context

`contextStrip` (`packages/render/src/usage.ts`) turns a run's recorded usage, the model's
`contextWindowTokens` and the runtime's `contextCompactionAt` capability into a `ContextStripView`:
the token count, the window, a `meter` (`percent`, `toCompaction`, `tone`) and a `reason` when no
fraction can be drawn. The weaver chat's finished-turn summary (`ChatTrace.tsx`), the Plan modal and
the run page (`RunPage.tsx`) all call it. Nothing on the Live floor does.

The number the automatic compaction policy reads is `agent_sessions.last_context_tokens`
(`packages/core/src/runs/dispatcher.ts`), written in `finalize` from the turn's
`usage.contextTokens` — the last API request's size, not the turn's totals (VS-98, VS-518). A run
row's `usage` is set only at finalize, so an *active* run has no usage at all; the Live floor, which
uses `useWorkerRun` to pick a worker's active run, therefore cannot read the last completed turn's
size from that run while a new turn is running.

The worker list (`GET /api/w/:ws/workers`) already joins per-worker state that is not on the `Agent`
row — the pending self-wake, the activity summary, the stall flag. It does not carry any session
context.

## Goals / Non-Goals

**Goals**

- Every Live card states the worker's context size for the last completed turn, and how full its
  model's window is, with the runtime's compaction point visible.
- One context figure across surfaces: the Live card and the weaver chat derive from `contextStrip`.
- An honest unknown-window state, and an honest absence before the first completed turn.
- A line that fits the existing card at phone width and leaves the grid, feed heights and toolbar
  untouched.

**Non-Goals**

- No change to `contextStrip`'s calculation or its inputs. The existing tests and golden values stand.
- No refactor of `ChatTrace.tsx`, `PlanModal.tsx` or `RunPage.tsx` to render through the new meter.
  The Plan modal is being replaced by a sibling ticket; keeping this change to Live and one new
  presentational component keeps it rebasing cleanly.
- No new SSE frame or live token feed: the figure only moves at the end of a turn, and it is labelled
  as such.
- No reconciliation of a session's last context with a model changed mid-session (see Risks).

## Decisions

### Source the figure from the worker's active session, exposed on the worker list

The ticket names `agent_sessions.last_context_tokens`, and it is the only value that exists while a
turn is running: an active run's `usage` is null until finalize. The workers list route will read the
listed agents' active sessions in one grouped query (`WHERE status = 'active' AND agent_id IN (…)`)
and add `lastContextTokens: number | null` to each item. The UI's `WorkerListItem` gains the field,
and `liveWorkingAgents` becomes generic (`<T extends Agent>`) so the field survives into the page's
cell input; today its `readonly Agent[]` return erases it.

**Finding: the session value is the post-compaction one.** In the ordinary case the session's
`last_context_tokens` equals the finished turn's own `usage.contextTokens`, so the Live card and the
weaver chat's summary agree for the same turn. When a runtime compacts within the turn, VS-518
leaves the session at the post-compaction size while the run's own usage stays pre-compaction; the
Live card follows the session — the figure the compaction policy actually acts on — and this
divergence is deliberate, not a second opinion about the same turn.

### Reuse `contextStrip`; add one presentational renderer

The card computes `contextStrip({ usage: { contextTokens: lastContextTokens }, contextWindowTokens,
compactionAt, hasRun })` and renders the result through a new `ContextMeter`
(`packages/ui/src/components/ContextMeter.tsx`) that takes the `ContextStripView`. The component only
draws what the shared view-model computed, so a second meter implementation cannot drift from it.
`contextWindowTokens` comes from the model the card already resolves for the worker's current run
(`resolveModel(useRuntimeModels(run.runtimeId), run.model)`), exactly as the run page does;
`compactionAt` comes from the runtime's `capabilities['contextCompactionAt']` through `useRuntimes()`,
exactly as the Plan modal reads it. The compaction marker is placed at `compactionAt` of the window
(clamped to the track), while the fill is `min(percent, 100)` and the tone is the view-model's
`tone` — so the threshold is a mark on the window bar, not a second scale.

### Unknown window and no-turn states are rendered, not hidden

`contextStrip` returns `{ tokens, tokensLabel, windowLabel: '—', meter: null, reason: 'Context
window unknown' }` when the window is unknown, and `reason: 'Context size unreported'` when the
runtime reported no per-request size. The meter renders the count with the unknown-window wording and
no bar for the first; for a worker whose session has no recorded size (a first, still-running turn)
the card shows no context line. This matches the ticket's "show the token count and say the window is
unknown, rather than inventing one or hiding the row", and the run page's `hasRun` gate.

### A fixed one-line strip that cannot reflow the card

The strip is a single `shrink-0` row between the ticket line and the feed: a thin track bar and a
right- or left-aligned `82k / 200k · last turn` mono label with `min-w-0 truncate`. It has a fixed
height and never wraps, so the header and ticket line keep their layout, the grid's columns and the
feed ladder are untouched, and at phone width it truncates rather than pushing the feed. The label
carries "last turn" (per the ticket's "label it as the last completed turn") and the token figure, so
the number is not read as live.

## Risks / Trade-offs

- **A model changed mid-session** (a runtime change retires the session, but a model or effort change
  keeps it): the session's last context may have been measured against the previous model, while the
  card draws it against the current run's model window. The card is at least internally consistent
  with the model it names in its own header. Reconstructing the historical window is out of scope.
- **The compaction-boundary divergence above** is a deliberate exception to "matches the chat"; it is
  recorded here and in the spec's `contextStrip` requirement, so a reviewer comparing the two after a
  compaction does not read it as a bug.
- **One extra read per workers-list call.** A single grouped `IN` query for the listed agents, not a
  query per worker; the route already performs per-worker reads (activity, stall, scheduled wake).
- **`useRuntimes()` per card.** TanStack dedupes the shared query key, so the floor still makes one
  request; existing `v2live.test.tsx` mocks `../api/hooks` wholesale and must add the new export.

## Migration Plan

No schema migration: `agent_sessions.last_context_tokens` and the runtimes' `contextCompactionAt`
capability both exist. The worker-list field is additive, so an older client ignores it and a newer
client against an older daemon shows no context line rather than breaking. Deploy the daemon and the
UI together; roll back the application if the list shape misbehaves.

## Open Questions

None.
