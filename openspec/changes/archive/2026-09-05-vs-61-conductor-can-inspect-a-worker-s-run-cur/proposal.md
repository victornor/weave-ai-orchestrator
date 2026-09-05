# Conductor can inspect a worker's run

Change for [VS-61](conductor://tickets/VS-61).

## Why

When a worker goes quiet, the conductor has no way to see what it is doing. `ac_worker_get` returns
the agent row and its brief; `ac_ticket_comments` returns whatever the worker chose to write. Neither
says which phase the run is in, how long it has been there, or what the last few tool calls were. The
daemon has all of it — every run event is stored in `run_events` and served at
`GET /api/w/:ws/runs/:id/events` — but that route requires a session, and a run token is only
accepted on `/mcp` and `/api/w/:ws/agent/*` (`packages/server/src/auth.ts`), so the conductor cannot
reach it.

The consequence is that the conductor's only supervision moves are the blunt ones: relaunch, cancel,
or ask the human. It has relaunched workers that were mid-`pnpm test`, and it has fallen back to
reading the host's process table from a shell. The `conductor attach` TUI and the web run page both
show this transcript already; the conductor is the one supervisor that cannot see it.

## What changes

- **`ac_run_inspect(ref, …)`** — conductor-only. `ref` is a ticket identifier, a worker id or a run
  id. Returns the run's identity and progress (id, status, turn, current phase, started at, elapsed,
  liveness, model, error), the worker's status and pause reason, and a compact transcript of the
  recent run events.
- **`ac_run_list(ref, limit?)`** — conductor-only. The recent runs behind that ticket or worker, each
  with status, liveness, duration, turn, error family and summary, so a retry ladder or a repeated
  failure is one call away.
- **Compact transcript rendering.** `packages/render` grows a plain-text serialiser over the
  `TranscriptBlock` model it already produces, so the conductor sees the same folded transcript the
  TUI and the web app see — assistant text truncated per block, a tool call and its result folded to
  one line, phase markers and errors in full — instead of raw JSON payloads.
- **Bounded output.** A per-call event limit (default 40, cap 200) and a total payload cap (32 KB),
  with an explicit truncation marker naming the cursor to continue from, so a runaway transcript
  cannot flood the conductor's context.
- **Tail, forward paging and `full`.** With no cursor the newest events are returned; `since: <seq>`
  returns events after that sequence; `full: true` starts from the beginning of the run. Every
  response says whether it was cut and where to resume.
- **Supervision guidance.** The conductor's `AGENTS.md` template and the
  `agent-conductor-conductor` skill say when to inspect — a worker quiet past its window, a ticket
  the human is asking about, a suspicious digest item — and that inspection comes before relaunching.

Read-only throughout: no new write path, no change to what the run engine records, and the redaction
`packages/render` already applies to anything that reaches a screen applies here too.

## Capabilities

### New Capabilities

- `worker-supervision/run-inspection`: what the conductor can see of a run it does not own — the
  run's phase and elapsed time, the worker's state, a bounded and redacted transcript, the run
  history behind a ticket, and who is allowed to ask.

### Modified Capabilities

None.

## Impact

- `packages/shared/src/tools.ts` — two names added to `CONDUCTOR_TOOLS`.
- `packages/render` — a plain-text serialiser for `TranscriptBlock[]`; no change to existing exports.
- `packages/core` — `RunsService.tail(runId, limit)`, the one read the existing service cannot do
  (`events()` pages forward from a sequence and cannot return a tail).
- `packages/server/src/tools.ts` — the two tool definitions, the reference resolver and the payload
  cap; `packages/server` gains a dependency on `@agent-conductor/render`.
- `docs/PLAN.md` §9.2, `docs/API.md`, `templates/conductor.AGENTS.md.tmpl`,
  `skills/agent-conductor-conductor/SKILL.md`.
- No database migration, no HTTP route change, no UI change.

## Out of scope

- Steering from the same tool — `ac_worker_message` already exists.
- Changing which run events the engine records, or the engine-side redactor.
- A `conductor run inspect` CLI command; `conductor attach` already covers the human's case.
