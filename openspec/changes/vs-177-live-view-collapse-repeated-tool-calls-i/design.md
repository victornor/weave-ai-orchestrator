## Context

See `proposal.md`. Constraints that shape the approach:

- Workspace Live (`packages/ui/src/routes/Live.tsx`) and global Live (`GlobalLive.tsx`) both mount
  `LiveCell` → `RunTranscript` → `Transcript`. There is no Live-only transcript renderer.
- `runEventsToTranscript` (`packages/ui/src/lib/transcript.ts`) already merges a `tool.call` with
  its `tool.result` into one `type: 'tool'` block. Consecutive same-name *blocks* are still one row
  each; that is what Live currently prints as `read read read glob read read`.
- `Transcript` windows to the newest 150 blocks (`WINDOW`). Grouping after the window can split a
  run at the cut; grouping before it cannot.
- `packages/render` has a separate TUI-facing transcript mapper. Out of scope (ticket: no TUI).
- jsdom tests already cover `Transcript` in `packages/ui/src/test/transcript.test.tsx`. Assert
  visible text and expand/collapse, not geometry.

## Goals / Non-Goals

**Goals:**

- Consecutive same-name tool blocks render as one counted row, expandable to the existing per-call
  rows.
- Workspace Live and global Live cannot drift: one presentation path.
- The grouping is a pure function of `TranscriptBlock[]`, unit-testable without the Live route.

**Non-Goals:**

- Changing how a call merges with its result.
- Collapsing across different names, or across a text/phase/status gap.
- A Live-only flag that leaves Ticket / Run / TurnTrace uncollapsed. Those already share
  `Transcript`; the ticket allows one fix when it is the same component. `conductor-chat/turn-work-trace`
  already requires matching the live view's transcript presentation.
- TUI (`packages/render`), Telegram, daemon, API, schema.

## Decisions

### D1. Group consecutive `type: 'tool'` blocks by exact `tool` string, after `runEventsToTranscript`

Add a pure helper next to `runEventsToTranscript` (same module or a sibling) that walks the block
list and folds adjacent `type: 'tool'` blocks with the same `tool` into a group of size ≥ 2. Other
block types pass through and split a run. Matching is the stored name (`Read` ≠ `Glob` ≠ `read`).

Do **not** fold inside `runEventsToTranscript`. That function's contract is "one block per call
(plus merged result)"; tests and the TUI-adjacent comment already describe that. Grouping is
display. `Transcript` calls the helper, then applies `WINDOW` to the grouped list so ten Reads
count as one slot.

**Rejected:** a `collapseRepeated` prop only on Live. Two code paths, and global Live would have to
remember to pass it. **Rejected:** collapsing in `LiveCell`. Ticket and Run would keep the noisy
list, and the existing turn-work-trace spec would then *disagree* with Live.

### D2. Collapsed head is `Name ×N`; a singleton is unchanged

N ≥ 2 → one row labelled with the tool name and the count (multiplication sign `×`, as in the
ticket). No target on the group head — the N paths differ, and putting the first one there looks
like a single call. N = 1 → today's `TranscriptLine` (name, target, duration / +/- , expand-if-diff).
Never `×1`.

The group row is a button (`aria-expanded`, accessible name that includes the tool and the count).
Expanded, it renders each member with the existing `TranscriptLine` so path/args/result expand the
same way they do today. Collapse is local React state on the group, same as a tool row's `open`.

**Rejected:** collapsing only completed calls and leaving pending ones listed. A live run of Reads
would flicker between grouped and ungrouped as results arrive. Pending members stay in the group;
the count is calls, not finished calls.

### D3. `file.changed` rows that already render as `type: 'tool'` join the same rule

`runEventsToTranscript` maps `file.changed` to `type: 'tool'` with `tool` = the operation (`Edit`,
…). Consecutive Edits collapse like consecutive Reads. That is the same "identical tool name"
rule, not extra product scope.

## Risks / Trade-offs

- [Chat live strip and expanded turn-traces also collapse] → accepted; same `Transcript`, and the
  ticket said one fix when it is the same component. TUI stays uncollapsed until a later ticket.
- [The 150-block window now counts groups, so a turn of 150 Reads plus other work shows more of the
  turn] → accepted; that is the point of collapsing. "Show earlier" still reveals older groups.
- [A runtime that emits `read` then `Read` will not collapse those two] → accepted; we match the
  name we already display, not a normalised alias table.

## Migration Plan

None. No stored data, no API, no flag. Rollback is revert.

## Open Questions

None.
