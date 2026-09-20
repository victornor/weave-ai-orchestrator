## Context

VS-595 delivered the runtime-neutral partial contract (`RuntimePartial`, `TurnSink.onPartial`, `capabilities.partialOutput`), the engine `PartialBuffer` (50 ms coalescing, redaction, no `run_events` rows), `GET /runs/:id/live`, the `liveTurn` model and the live activity row, and wired opencode. This change is its slice-3 follow-up: cursor and gemini, the two runtimes whose CLIs already expose text deltas. The model, the frames and the page are contract; only the adapters and the coverage table change. Read `openspec/changes/archive/2026-09-20-vs-595-a-running-worker-page-must-show-live-pro/design.md` §3–§4 for the contract and the runtime coverage table this implements.

**Capture rule.** The platform forbids launching a real coding CLI from a ticket (one OAuth refresh can rotate the daemon's shared credential and sign every agent out). `cursor-agent` needs the owner's live Cursor login, so its fixture cannot be a live recording from here. Instead the protocol below was read from the installed binaries' own files — `~/.local/share/cursor-agent/versions/2026.09.10-fd3934a` (help text and the `stream-json` writer) and the installed gemini 0.60.0 bundle (the `stream-json` emit sites) — which is stronger than the documented protocol and does not execute anything. The fixture header says it is bundle-derived, not recorded, and the PR states plainly that the owner must check one real run of each.

## Goals / Non-Goals

**Goals:**
- Cursor and gemini assistant text streams to the page as it is generated, through the VS-595 partial channel.
- No per-delta growth of `run_events`: each adapter persists one coalesced `assistant.text` per assistant message, carrying the `partId` that supersedes its partial.
- The completed event and the partial never both render the same text.
- Every existing turn guarantee is kept: resume, cancel, cut-off, `finalText`, usage, error classification.

**Non-Goals:**
- Claude (slice 2, VS-599) and codex (a follow-up driver ticket). Neither adapter is touched.
- Reasoning or tool-input partials: both CLIs expose text deltas only with the invocation this adapter uses, so both declare `'text'`, not `'full'`.
- Any change to the engine, the frames, the live-turn model or the page components; only their tests gain the cursor/gemini cases.

## Decisions

### Decision 1 — both runtimes declare `partialOutput: 'text'`; nothing else changes upstream

The engine, `run.delta` frames, `GET /runs/:id/live`, redaction, the `liveTurn` model and the live row already exist and are runtime-neutral. An adapter that calls `onPartial` and persists a completed event carrying the same `partId` needs no upstream change. The page's coarse coverage map, `RUNTIME_PARTIAL_OUTPUT` in `packages/shared/src/events.ts`, gains `cursor: 'text'` and `gemini: 'text'`; the row then stops saying "whole steps only". Each adapter's test pins `capabilities.partialOutput` to this table (the pattern opencode already uses), so the two cannot drift.

### Decision 2 — cursor: use `--stream-partial-output`, deltas to `onPartial`, the flush to the transcript

The installed `cursor-agent` (2026.09.10) writes, for every text delta when `--stream-partial-output` is set:

```json
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"<chunk>"}]},"session_id":"…","timestamp_ms":1726…}
```

and, before each tool call and at turn end, flushes the whole accumulated model-call text as one `assistant` event of the same shape whose `text` is the full text (`type:"assistant"`, `message.content[0].text = Ce`, with `session_id` and optionally `model_call_id`/`timestamp_ms`). Without the flag only the flush events exist — the adapter's current input.

So: `buildArgs` adds `--stream-partial-output`; the parser is told the flag is on. A text `assistant` event is a **delta** (→ `onPartial`, appended to a per-message buffer) until an event arrives whose `text` equals the accumulated buffer — that is the **flush**, and it becomes the one persisted `assistant.text`, carrying the message's `partId`. The parser buffers with the buffer/equality test because it is self-contained and does not depend on `model_call_id` being present; the recorded fixture pins the exact shape and, if a structural marker (`model_call_id`) proves reliable, the flush test is narrowed to it. With the flag off the parser behaves as today (every `assistant` text event is the flush).

`partId`: a per-assistant-message id (`cursor:msg:<n>`, or the CLI's `model_call_id` when present). The adapter's `onLine` currently only forwards events; it gains the `onPartial` call the parser exposes.

`--show-thinking` is deliberately not used: the installed help says it works only with `--output-format json`, not `stream-json`, so there is no reasoning delta to report and the declaration is `'text'`.

### Decision 3 — gemini: deltas are partials, one coalesced `assistant.text` per message

The installed gemini 0.60.0 bundle emits every assistant chunk as a `message` event with `delta: true` and **no** separate completion message; the turn's end is the `result` event. Today `createGeminiParser` emits one persisted `assistant.text` per chunk; `runEventsToTranscript` merges adjacent ones, so the screen is right but `run_events` grows with the token count — the bloat VS-595's design explicitly avoids.

Decision: feed each `message` delta to `onPartial` with a stable `partId` per assistant message, accumulate in the parse state, and emit a single persisted `assistant.text` carrying the full text and that `partId`, flushed when the next non-text event arrives (`tool_use`, `result`, `error`) and in `finish()` for a cut-off stream. `state.finalText` and the `result`-driven usage/error paths are unchanged, because they read the same accumulator. A cut-off stream therefore still keeps the text it produced.

### Decision 4 — the completed event supersedes, so neither page shows text twice

Both adapters put the `partId` on the persisted `assistant.text`. `livePartials.dropSuperseded` drops a partial as soon as an event with that `partId` is present, and the page appends partial text as a trailing block only. So a cursor/gemini turn shows growing text once, then exactly one completed block. This is the same contract opencode already exercises.

## Risks / Trade-offs

- **Cursor delta/flush discrimination.** The flush text equals the deltas' concatenation, so the buffer-equality test is exact for a normal message; a pathological repeated-chunk message could be misread. The fixture pins normal ordering, and the owner's one real run is the acceptance check. If the real run shows `model_call_id` reliably on the flush, the test is narrowed to that marker.
- **Gemini persisted transcripts change shape** (one `assistant.text` per message instead of one per chunk). The rendered transcript is identical (adjacent text already merged) and `finalText` is unchanged; `weave_run_inspect` shows fewer rows — strictly less noise, and tests assert the merged output, not the row count.
- **Fixture fidelity.** The fixtures come from the installed bundles, not a live run (the hard rule). Stated in the fixture header and the PR; the owner runs one real turn per runtime.
- **Redaction.** The engine's `PartialBuffer` releases secret-straddling text whole or not at all; cursor/gemini partials ride it unchanged. A test feeds a secret across two gemini chunks and across two cursor deltas and asserts it never appears.
