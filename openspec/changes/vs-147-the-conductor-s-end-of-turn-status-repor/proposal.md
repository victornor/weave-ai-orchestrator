## Why

Every agent turn ends with a fenced ```json structured report (state, summary, tickets, nextAction,
knowledge, uncommittedWork) — required machine bookkeeping for the daemon, never meant for a human
reader. `packages/ui/src/lib/transcript.ts`'s `runEventsToTranscript` treats every `assistant.text`
event uniformly, so this trailing block becomes an ordinary `type: 'text'` transcript line, and
`Transcript.tsx` renders it as a bare paragraph — full raw JSON, no collapsing, no special
treatment — inside the collapsed-by-default turn work trace (`conductor-chat/turn-work-trace`).
Because that trace is deliberately shown to the human (VS-74) so they can read back what a turn
did, the report is the largest, least readable thing in it on every single turn, immediately beside
a nicely collapsed `StructuredOutput` tool row rendering the same data.

## What Changes

- `runEventsToTranscript` (`packages/ui/src/lib/transcript.ts`) detects a text block whose content
  parses as a valid run report (via `extractReport` from `@agent-conductor/shared`) and emits it as
  a distinct `report` block instead of a `text` block.
- `Transcript.tsx`'s `TranscriptLine` renders a `report` block collapsed by default, in the same
  visual register as a tool row (one-line summary, expandable), never as a raw fenced code block in
  the message flow.
- Out of scope: `packages/render/src/transcript.ts` is a separate, TUI-only implementation of the
  same idea with the same gap; the ticket only asks about the web chat view, and folding the two
  implementations together is a larger de-duplication this change does not take on.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/turn-work-trace`: expanding a turn's trace renders its trailing structured report
  as a collapsed detail, not as plain conversational text.

## Impact

- `packages/ui/src/lib/transcript.ts`, `packages/ui/src/components/Transcript.tsx`
- No server or data-model change: the report is already parsed and validated server-side
  (`packages/shared/src/report.ts`); this only changes how the existing `assistant.text` event is
  presented once it reaches the web client.
