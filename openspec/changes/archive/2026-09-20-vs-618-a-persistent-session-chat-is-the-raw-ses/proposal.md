## Why

A persistent role session is a direct, standing conversation with a worker. Its web chat is not the
session today: it shows the human's messages and each turn's delivered final answer, and a turn that
only ran tools is announced to the human as "This turn ended without an answer." — a weaver rule
(nice, clean, thoughtful replies) applied where no middleware belongs. Captain, 2026-09-20: a
persistent session's chat is the raw session; it must not obey answer-shaping guidelines.

## What Changes

- **No "ended without a response" for a session.** A succeeded session turn whose final text is
  absent or whitespace-only writes no message at all — no answer, no system notice. It is a normal,
  complete turn. A turn that really failed, timed out, was cancelled or was interrupted still posts
  its plain-reason notice naming the cause.
- **The session chat is the raw session.** Each turn renders as the worker transcript does: the
  human's message, then that turn's full transcript — assistant text as it was written, tool rows,
  `edit`/`write` as diffs, file previews, command rows with output, syntax highlighting — interleaved
  in order, live while the turn runs and unchanged after it ends. The chat scrolls as one page; it
  does not nest a second scroller.
- **The final text is not shown twice.** A turn's delivered final text is no longer rendered as a
  separate chat bubble; the transcript is where it appears. The engine's thread delivery is kept, so
  a session bridged to a channel (Telegram) still gets its answer.
- **No answer-shaping.** A ticketless session is no longer given the worker's per-turn instruction to
  "do the phase your ticket status asks for … finish with the structured final report"; a
  conversation instruction replaces it. The weaver's rules are untouched.
- No API, database or dependency change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `persistent-sessions`: the no-answer system notice is removed for a succeeded session turn; the
  session's conversation surface shows each turn's full transcript; a ticketless session is not
  instructed to produce the worker's structured final report.
- `interface-live-progress`: a session's live turn is rendered as the turn's own transcript, which
  stays after the turn ends; the "a system notice replaces the live turn" behaviour changes because
  the notice no longer exists for a turn that produced no final text.

## Impact

- `packages/core/src/runs/engine.ts` — the session delivery step (`deliverSessionAnswer`): drop the
  empty-answer branch; keep the outcome notices (`sessionOutcomeNotice`).
- `packages/core/src/prompts/index.ts` — `whatToDoNow`: a ticketless session gets a conversation
  instruction instead of `WORKER_DELIVERY_NOW`.
- `packages/ui/src/v2/WorkerPage.tsx` — `SessionThreadFeed`, plus a small pure conversation-row
  helper and a per-turn renderer reusing `components/Transcript.tsx`, `LivePartials` and
  `LiveActivity`; no new renderer.
- Tests: `packages/core/src/runs/engine.test.ts`, `packages/core/src/prompts/render.test.ts`,
  `packages/ui/src/test/v2worker.test.tsx`.
- No `docs/API.md`, no migration, no dependency.
