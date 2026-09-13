# V2 Chat traces collapse by default, and Refresh only when the stream drops

Tracker change for [VS-370](weave://tickets/VS-370). A `task` ticket, so this change
carries tasks only — `skip_specs: true`.

## Why

Captain finds V2 Chat traces cluttered. Three consecutive `bash` calls render fully
expanded with all of their output, where V1 folds them into one collapsed `bash ×3`
line inside a scrollable container. And a **Refresh** button sits under the live
trace's "working" label even when the stream is healthy, so it reads as something to
press for no reason.

## What changes

- `packages/ui/src/v2/ChatTrace.tsx` — `ToolGroup` starts collapsed (`▸`, `bash ×3`)
  and opens to list its calls; a single tool call shows its one-line summary with its
  result behind its own disclosure. Tool results and `command` output render inside a
  height-capped, scrollable container (`ac-scroll max-h-40 overflow-auto`), keeping the
  diff colouring. Expansion state lives in the component, so an opened group stays open
  as new events arrive and a closed one does not re-open itself.
- `ChatTrace.tsx`'s finished-turn `ChatTurnTrace` outer open state is remembered per turn
  through `lib/traceExpansion.ts`, as V1's `TurnTrace` is.
- `packages/ui/src/v2/ChatPage.tsx` — "The live stream dropped." and its **Refresh**
  only render when `runStreamStatus.state` is `unreachable` or `offline`; a healthy
  live trace shows just "working".

Two later additions on the same ticket (captain, 2026-09-13):

- `packages/ui/src/v2/ChatComposer.tsx` — the textarea opts out of the global
  `:focus-visible` ring (`focus-visible:[box-shadow:none]`, as V1's shared `Composer`
  does), so clicking into the message box shows only the caret; the attach, dictate and
  send buttons keep their focus-visible indication.
- `packages/ui/src/v2/ChatTrace.tsx` — an edit/write tool call shows its file path,
  collapsed by default, opening to highlighted hunks in the capped scroll container.
  The body is V1's `EditPayloadBody` (newly exported from `components/Transcript.tsx`),
  so the `diffHunksForEdits` derivation, `DiffHunks` and 40-line window are reused, not
  re-implemented. `WorkerFeed` already renders edits through `RunTranscript`.

V1's behaviour is the reference and is unchanged. `WorkerFeed` already uses
`RunTranscript`, so it stays compact and already shows edit diffs.

## Out of scope

Any change to the view model (`lib/transcript.ts`), V1, or the daemon.
