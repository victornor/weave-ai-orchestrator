## Why

VS-58 gave the conductor chat a live view of the turn in flight: assistant text as it arrives, a block per tool call, the results folded back in. `conductor-chat/live-turn-stream` also made that view deliberately transient — "the live transcript SHALL be cleared when the run finishes" — because the alternative at the time was rendering the reply twice, once as streamed text and once as the thread message.

The cost of that is what the workspace owner reports: everything the conductor actually carried out is wiped the moment the turn ends, and the history keeps only the sentence it chose to say. A turn that read six tickets, filed two and answered a decision reads back as one paragraph. Nothing is lost — the events are on the run, and the Run page and the ticket's Activity tab already render them (VS-59) — but from the chat, which is where the human was watching, they are unreachable.

The pieces are all in place. Every outbound conductor message already carries the `runId` of the turn that sent it (`ac_human_send` passes it to `threads.outbound`), so history written before this change links to its run too. `GET /runs/:id/events` already pages a run's events and `useRunEventStream` already reads a finished run without opening a stream. What is missing is a cheap way to say *what a turn did* without loading its events, and the chat rows that show it.

## What Changes

- **A finished conductor turn keeps a collapsed "what it did" section under its reply.** One line — tool calls, files touched, duration — with an expand control. Expanded, it renders the turn with the same transcript component the live stream, the Run page and the ticket's Activity tab use.
- **The trace is fetched only when it is expanded.** The collapsed line is served by a new per-run aggregate the daemon computes over `run_events`; the events themselves are requested on the first expansion and not before, so history paging (VS-39) stays as light as it is today.
- **The expansion state is remembered per turn for the session**, in `sessionStorage` beside the composer drafts, so scrolling back through a long history does not re-collapse what was opened.
- **A turn that produced no message appears as a compact trace-only row** at the time it ran — the wake that only filed a ticket, or ended with nothing to say. Collapsed by default, expandable like any other, and hideable with a per-device chat preference in Settings → This device.
- **The live view folds into the collapsed section without a gap.** The streaming block is held until the row that replaces it is on screen, rather than being cleared the instant `run.finished` arrives and leaving the list to jump while the thread refetches.
- **A message that cannot be linked to a run shows nothing extra**, which is what old history from other channels does.

## Capabilities

### New Capabilities

- `conductor-chat/turn-work-trace`: what a finished conductor turn leaves in the chat — the collapsed summary, the on-demand transcript, the trace-only row for a silent turn, and the run-trace aggregate the daemon serves.

### Modified Capabilities

- `conductor-chat/live-turn-stream`: the live transcript is no longer cleared into nothing when the turn ends; it is replaced by that turn's collapsed trace. The reply text is still shown exactly once, and the delivery tool call is still omitted.

## Impact

- `packages/db/` — no schema change; the aggregate reads `run_events`.
- `packages/shared/src/types.ts` — a `RunTrace` record: run id, status, timing, tool-call / file / error counts.
- `packages/core/src/api.ts`, `packages/core/src/runs/index.ts` — `RunsService.traces()`, one grouped aggregate over `run_events` for a set of runs.
- `packages/server/src/routes/runs.ts`, `docs/API.md` — `GET /runs/traces`, registered before `/:id`.
- `packages/ui/src/api/{keys,hooks}.ts` — `useRunTraces`, invalidated when a run finishes.
- `packages/ui/src/lib/dispatch.ts` — `chatRows`, a pure function ordering messages and trace-only rows.
- `packages/ui/src/lib/traceExpansion.ts` — the per-session expansion set.
- `packages/ui/src/components/TurnTrace.tsx` — the collapsed summary and the expanded transcript.
- `packages/ui/src/routes/Chat.tsx` — rows instead of entries; the live block held until its row exists.
- `packages/ui/src/routes/Settings.tsx`, `packages/ui/src/lib/chatPrefs.ts` — the "silent turns" toggle.
- Tests: `packages/core/src/runs/traces.test.ts`, `packages/ui/src/test/{chat,dispatch,turnTrace}.test.tsx`.

## Out of scope

- Worker transcripts in the conductor chat; they live on the ticket page.
- Anything the daemon records in run events — the aggregate counts what is already there.
- The terminal chat (`packages/tui/`) and the Telegram channel.
