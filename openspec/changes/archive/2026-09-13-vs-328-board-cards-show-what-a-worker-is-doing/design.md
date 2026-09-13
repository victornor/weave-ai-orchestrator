## Context

The board (`packages/ui/src/routes/Board.tsx`) knows a worker is live only from `useWorkers` and the
`liveWorkersByTicket` map; `TicketCard`/`TicketRow` render a pulsing `StatusGlyph` and nothing else.
Mid-turn activity never reaches it: the workspace event stream carries only `run.started`/
`run.finished`, and the only per-run stream is `useRunEventStream`, which VS-227 caps at two
concurrent tails (`packages/ui/src/lib/liveStreams.ts`) — so a card-per-run stream is not available.

Verified from source, not assumed:

- **There is no activity or test tally anywhere today.** The closest data is `run.summary` (the
  agent's end-of-turn summary), `run_events` rows, and the render layer's `toolTarget`/
  `collapsedToolLine` (`packages/render/src/transcript.ts:75,431`).
- **The forge already fetches the check rollup but the daemon discards the useful part.**
  `GhForge.prState` returns `ciState` (`packages/core/src/forge/gh.ts:124-132`), the supervisor
  reconcile drops it (`packages/core/src/supervisor/index.ts:729-730`), and it has no passed/total
  counts. `ForgeAdapter` (`packages/plugin-sdk/src/index.ts:39`) is the boundary to extend.
- **Command output is truncated head-first at the adapter.** Each runtime calls
  `truncate(text)` (`packages/runtime-sdk/src/fsutil.ts:106-109`, 8192 chars) before emitting
  `command.executed`; `boundPayload` then caps the whole payload at 8 KB
  (`packages/core/src/runs/engine.ts:67-72`). A long test run's summary is at its **end**, so parsing
  after the fact from stored output would frequently find nothing. The tally must be parsed before
  the output is bounded.
- **`EventBus.emit` writes an outbox row per event** (`packages/core/src/events.ts:10-17`), and the
  project already learned that a row-per-run-event signal is too expensive (`run.event` is declared
  and never emitted, VS-9). A live activity push must not go through the durable outbox at tool-call
  granularity.
- **The board already consumes one stream per workspace** (`EventStream`,
  `packages/ui/src/api/context.tsx:35-51`), and components can subscribe to raw frames with
  `useWorkspaceEvents` (`context.tsx:82-90`).

## Goals / Non-Goals

**Goals:**
- One server-side derivation of the activity line and test tally, reaching both the workers read and
  a cheap live push, so a card needs no new connection.
- One pure tool-to-verb mapping and one pure per-runner test parser, tested against real payload and
  runner shapes.
- Keep the card's existing density; nothing new wraps or grows it.

**Non-Goals:**
- Changing the Live grid, the ticket page, the worker page or the run page.
- Adding a new persisted event type or a new REST route.
- Line-level parsing of a runner's output beyond its summary line; no test count is inferred.
- Reconciling the two transcript builders; unrelated.

## Decisions

**The activity line is derived in core and pushed, not derived per card in the browser.** Deriving it
client-side would need the run's events at the board, which is exactly the per-card stream VS-227
forbids. The daemon already holds every run event as it is recorded, so `WorkerActivityService` is
fed there.

**A pure `workerActivity(event)` lives in `packages/render`, beside `toolTarget`.** `packages/render`
is the existing home of transcript/tool semantics, is dependency-light (shared only), and is already
imported by both `core` and `ui`. It maps the normalized event shape — not runtime text — to
`{ label, verb, target }`, using the same target extraction `toolTarget` already does (file path,
command, url, pattern). It recognises an edit/write by tool name (`Edit`/`Write`/`MultiEdit`/
`NotebookEdit`, `edit`/`write`/`patch`/`multiedit`, `replace`/`write_file`), a read/search by name
(`Read`/`Grep`/`Glob`, `read`/`grep`/`glob`), a web action by name (`WebFetch`/`WebSearch`, codex
`web_search`), and falls back to `Working`. Because Codex emits `file.changed` and `command.executed`
with no `tool.call`, the mapper keys off the event type as well as the tool name.

**The test parser is a pure `parseTestSummary(output)` in `packages/shared`.** It must run inside the
runtime adapters, and the adapters may import `shared` only (`scripts/guard-boundaries.mjs`), so
shared is where it belongs. It matches each runner's own summary line (vitest `Tests  N passed (M)`,
jest `Tests:  N failed, M passed, T total`, bun `N pass`/`M fail`, `node --test` `# pass`/`# tests`,
pytest `N passed`/`N failed`, cargo `test result: ... N passed; M failed`, dotnet
`Passed! - Failed: N, Passed: M, Total: T`). `go test` has no single total: the parser counts
`--- PASS`/`--- FAIL` per test within one output, and returns null when it cannot read a confident
tally. Anything unreadable returns null, and no caller substitutes a guess.

**Each adapter parses the tally from its command output before truncating it, and carries it on the
`command.executed` payload** (for example `tests: { passed, total }`). This is the one place the whole
output exists; parsing there keeps the transcript output unchanged and avoids a schema change. The
mapping is mechanical and tested per adapter.

**`WorkerActivityService` (`packages/core/src/activity/`) is the single writer of the summary.** It is
constructed per workspace with the other services and exposed on `CoreServices`. The run engine's
`record()` calls `observe(agent, ticket, event)` for each recorded event; the service keeps, per
worker, `activity: { label, verb, target, since } | null` (since set when the label first appears and
preserved while it does not change) and `tests: { passed, total } | null` (set when a
`command.executed` carries a parsed tally; never cleared by a later testless event). Activity is
cleared when the run finalizes; tests are kept. The service exposes `summaryFor(agentId)`.

Because the parsed tally rides the persisted `command.executed` payload, `summaryFor` lazily rebuilds
a worker's tally it does not hold in memory by reading that worker's runs newest-first and returning
the most recent parsed tally, then caches it. Activity is never rebuilt from history — only live
events set it — so a worker between turns cannot be shown a stale activity line after a restart.

The lazy rebuild is bounded so `GET /workers` stays cheap after a restart: it inspects at most the
worker's most recent `WORKER_ACTIVITY_REBUILD_RUNS` runs (a small constant, e.g. 5) and at most
`WORKER_ACTIVITY_REBUILD_EVENTS` `command.executed` events overall (e.g. 200), newest-first, and a
result is cached per worker so the scan runs once. A worker with no tally inside that window reports
none rather than scanning its whole history.

**The summary is pushed on the existing workspace stream as an ephemeral frame, not through the
outbox.** `EventBus` gains a `broadcast(type, entityId, payload)` that emits to the in-process bus
without writing an `events` row; the workspace SSE route forwards those frames (no `id`, no cursor
advance) alongside the persisted ones, and the UI adds the type to its `TRACKED` listeners. This is
"carried on the stream the board already consumes" without a row per tool call. The service throttles
to at most one frame per worker per `ACTIVITY_PUSH_MS` (2000 ms), coalescing to the latest summary,
with an immediate flush when the run finalizes so the last state lands. The workers read carries the
same summary as the base, so a fresh load and a missed frame both converge.

*Alternative considered and rejected:* a second dedicated activity SSE endpoint — more connection
bookkeeping for no gain over the frame the existing stream can carry. *Alternative considered:* a
persisted `worker.activity` outbox event — rejected for the row-per-tool-call cost above.

**The board keeps a live override map and merges it over the workers read.** `Board.tsx` subscribes
with `useWorkspaceEvents`, and for each activity frame stores `{ agentId → summary }`; the card for a
live worker takes the override's summary, else the one from `useWorkers`. This redraws only frames
that arrive; it never invalidates the whole workers query per update. Frames are coalesced to one
state update per animation frame so a burst cannot re-render the board many times a second.

**The relative time ticks in a leaf, not the board.** A small `ActivityLine` component owns a 1 s
interval while it is shown and formats `(now − since)`; only those leaves re-render. This keeps the
"time since it began" honest between tool calls without a board-wide clock.

**PR check counts are persisted on the delivery record, not fetched per card.** `ForgeAdapter.prState`
returns an optional `checks: { passed, total }` (derived from the rollup it already fetches), the
supervisor reconcile writes `delivery.prChecks = { passed, total }` and `delivery.ciState` alongside
the existing `prUrl`/`prState`, and `TicketCard`/`TicketRow` read them. The project PR list already
shows the rolled-up state with no counts; this adds counts where the card needs them without a new
fetch. No migration: `delivery_json` is an existing free-form column.

**The reconcile writes the check tally whenever it differs, not only when the PR's state changes.**
`reconcilePullRequests` currently writes `delivery_json` only inside `if (pr.state !== row.state)`
(`packages/core/src/supervisor/index.ts:722-731`), so a PR that stays open while CI runs would freeze
the tally at whatever it read when the state last moved. The check state and count are compared
against what the ticket's delivery already holds and written whenever they differ, independent of the
state change, and that write emits `ticket.updated` so the board's tickets query (what the card reads
its delivery from) refreshes without a reload. The state-change branch keeps emitting
`ticket.work_product` as it does today. A forge error is still swallowed and leaves the previous
record in place.

**Layout is bounded to two extra rows.** The activity line sits under the title (one row, truncated);
the test tally and the PR-checks line share the existing footer row as additional small chips, so the
card grows by at most two rows and never wraps.

## Risks / Trade-offs

- **The ephemeral frame bypasses replay.** A client that reloads gets the summary from `GET /workers`;
  a client that misses a frame gets the next one, and the workers query is still invalidated on
  `run.started`/`run.finished`. Acceptable, and cheaper than persisting.
- **`go test` and unconventional runners may yield no tally.** The parser is deliberately
  conservative; the board shows nothing rather than a wrong count, which is the ticket's own rule.
- **Parsing in five adapters is repetitive.** Mitigated by one shared pure parser and a per-adapter
  test asserting the carried tally; the field is optional so an adapter that misses it degrades to
  no tally, never to a crash.
- **The throttle can show a stale label for up to two seconds.** That is the intended trade against
  board re-renders; the final state is flushed at finalize.

## Migration Plan

No data migration. `delivery_json` gains optional keys read defensively by `outcomeOf` and the new
card line. The activity summary is in-memory; a worker's last tally is also readable from its
persisted `command.executed` payloads, so `summaryFor` rebuilds it after a daemon restart and a
between-turns worker is never shown a stale activity line. Deploys as an ordinary PR merge; no flag,
no staged rollout.
