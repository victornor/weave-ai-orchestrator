## Context

See `proposal.md — Why`. The facts that shape the approach:

- Run events already exist and are already redacted at write time by `makeRedactor`
  (`packages/core/src/runs/engine.ts`). This change reads them; it does not change what is recorded.
- `packages/render` already turns `RunEvent[]` into a folded `TranscriptBlock[]`
  (`runEventsToTranscript`) and already redacts every string it emits (`redact`). The web run page
  and `conductor attach` both render those blocks. It is a leaf package: it imports `shared` and
  nothing else.
- `RunsService` (`packages/core/src/api.ts`) already has `list`, `get`, `events(id, afterSeq, limit)`
  and `cancel`. `events` pages **forward** from a sequence; there is no way to read a tail.
- Run phases are `RUN_PHASES` in `packages/shared/src/enums.ts` and are recorded as
  `run.phase.timing` events **when the phase ends** (`engine.ts:141-143`, the `finally` block).
- Tools live in one registry, `packages/server/src/tools.ts`, with a `scope` of `all | conductor |
  worker`. `runTool` refuses a tool outside the caller's scope before parsing input, and
  `toolNamesFor` decides what MCP advertises. Names come from `packages/shared/src/tools.ts`.

## Goals / Non-Goals

**Goals**

- One read path that answers "what is this worker doing right now" with evidence, in bounded output.
- Reuse the transcript semantics that already exist rather than growing a second renderer.
- No new service, no migration, no route.

**Non-Goals**

- A live stream. The conductor is a turn-based agent; it polls, it does not subscribe.
- A CLI or web surface. Both already have `conductor attach` and the run page.
- Any change to the redactor, to the engine, or to what an event carries.

## Decisions

### The tools compose existing services rather than adding a new one

`ac_run_inspect` and `ac_run_list` are built in `packages/server/src/tools.ts` from
`tickets.get`, `workers.get`, `runs.list`, `runs.get` and `runs.events`. No new member is added to
`CoreServices`.

*Why:* adding a member to `CoreServices` breaks every test harness that proxies unstubbed services
into a throw (`packages/core/src/testing/context.ts`, `packages/server/test/fakes.ts`), for no gain
here — the composition is a resolver plus a renderer, not a domain concept with its own invariants.

*Alternative considered:* a `SupervisionService` in core. Rejected as premature: it would own one
read and force both harnesses to grow a stub.

### One new core read: `RunsService.tail(runId, limit)`

`tail` returns the last `limit` events of a run in ascending sequence order
(`ORDER BY seq DESC LIMIT ?`, reversed). It is added to the existing `RunsService`, not to a new
service, so only tests that call it need a stub.

*Why:* the default view is the tail, and the alternative — `events(id, 0, huge)` and slice — loads
the whole run into memory. A run can hold thousands of events.

### `packages/render` grows a plain-text serialiser; the tool does not re-implement folding

A new `transcriptToLines(blocks, opts)` in `packages/render` maps each `TranscriptBlock` to
`{ seq, ts, kind, text }`:

| Block | Line |
|---|---|
| `text` / `thinking` | the block's text, truncated to a per-entry budget |
| `tool` | the block's existing `collapsed` line, plus the first line of its detail on failure |
| `file` | the block's existing `collapsed` line |
| `phase`, `status` | the block's `text`, in full |
| `error` | code and message, in full |

`packages/server` gains a dependency on `@agent-conductor/render` (package.json + tsconfig
reference). `render` is a leaf and no boundary rule forbids it; `core → server` is the only direction
the guard cares about.

*Why:* the folding, the target extraction and the redaction are the hard parts and already exist and
are golden-tested. Re-implementing them in the tool would give the conductor a transcript that
disagrees with the one the human sees on the run page — the worst possible outcome for a supervision
tool.

*Alternative considered:* returning `TranscriptBlock[]` as JSON. Rejected: several times the tokens
for the same information, and the conductor has no renderer.

### Current phase is derived, and derived conservatively

`run.phase.timing` is emitted when a phase *ends*, so the current phase is the `RUN_PHASES` entry
after the last one recorded. A run with no timing yet is in the first phase; a run whose status is
not active reports no current phase at all. Completed phases are returned with their durations.

*Why:* the alternative is a new `runs.current_phase` column written by the engine — a schema change
and a second source of truth for something the events already state. The derivation is exact except
in one case: a phase that is skipped (`prepare_worktree` for the conductor, which has no worktree)
shifts the derived phase one step early. Accepted, because the phase list returned alongside makes
that visible, and because `elapsed` — the number the supervisor actually acts on — is unaffected.

### Cursor semantics: tail by default, forward from `since`, `full` from the start

- no `since`, no `full` → the newest `limit` events.
- `since: n` → events with `seq > n`, up to `limit`.
- `full: true` → equivalent to `since: 0` with `limit` raised to the maximum.

Every response carries `{ totalEvents, firstSeq, lastSeq, truncated, resumeFrom, omittedBefore }`.
`resumeFrom` is the sequence to pass as `since` next; `omittedBefore` counts entries dropped off the
front to fit the size cap in tail mode.

*Why:* one cursor direction is enough. Paging *back* is choosing a lower `since`, and the response
always states the sequence range it covered, so the conductor never has to guess one.

### The size cap is applied after rendering, by dropping whole entries

Lines are serialised until the running JSON size would exceed 32 KB. In forward mode the overflow is
dropped from the end and `resumeFrom` is the last included sequence. In tail mode it is dropped from
the front, `omittedBefore` counts them, and the newest entries survive. A single entry larger than
the remaining budget is itself truncated so that the cap holds unconditionally.

*Why:* the cap must be a guarantee, not a target — the point of the tool is that it cannot flood the
conductor's context. Dropping whole entries keeps every line that is returned valid and readable.

### Scope is enforced by the registry, not by the handler

Both tools are declared `scope: 'conductor'` and their names are added to `CONDUCTOR_TOOLS`. That is
what makes `runTool` return `forbidden` for a worker and what keeps them out of the worker toolset
MCP advertises.

*Why:* every other conductor-only tool works this way; a handler-side check would be a second,
divergent rule. Workspace scoping is already implicit — `ws.services` is workspace-bound and
`runs.get` filters on `workspace_id`.

## Risks / Trade-offs

- **The conductor reads a transcript and pastes it to the human.** → The skill already forbids
  relaying a worker's tool output verbatim; the supervision section added by this change repeats it
  at the point of use, and the tool's description says the output is evidence, not a message.
- **Inspection replaces action.** A conductor that inspects and then does nothing is worse than one
  that relaunches. → The skill's supervision table keeps the existing action for each signal and adds
  inspection as the step *before* it, with the second failure still escalating to the human.
- **Derived phase is wrong for a skipped phase.** → Bounded, visible, and documented above; the
  completed-phase list is the ground truth and is returned.
- **`packages/server` depending on `@agent-conductor/render` is a new edge.** → `render` is a leaf
  with a single dependency on `shared`; the boundary guard has no rule against it and the daemon
  already ships the package inside the release.
- **A large `full: true` on a long run is a heavy query.** → `limit` is capped at 200 events
  regardless of `full`, so the query is bounded whatever the caller asks for.

## Migration Plan

None. Two additive tool names, one additive service method, one additive render export. Older
clients are unaffected; a daemon that has not been upgraded simply does not advertise the tools.
