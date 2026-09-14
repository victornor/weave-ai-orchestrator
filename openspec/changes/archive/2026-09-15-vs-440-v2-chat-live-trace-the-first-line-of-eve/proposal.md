# V2 chat: stream each turn's first trace line, and a back-to-back turn

Tracker change for [VS-440](weave://tickets/VS-440). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

VS-433 streams the weaver's live working trace line by line, but two gaps remain.

1. **The first line of every turn never streams.** `ChatPage` renders the live `ChatTrace` only once
   `liveEvents.length` is non-zero, so `ChatTrace` mounts with its first event already present.
   `useNewLiveIds` takes its baseline — the highest `seq` on screen — on that first render, so the
   turn's first line counts as history and pops in whole. Only later lines stream.
2. **A back-to-back turn may not stream.** `seq` is per run. When one turn ends and the next starts
   without the live section unmounting, the baseline from the first run stays, and the new run's
   `seq` restarts below it — none of its lines are "new" until its `seq` passes the old maximum.

## What changes

- **`useNewLiveIds(events, runId)` is scoped to the run.** The baseline is taken on the render that
  first sees a run id, so a run watched from its start has no baseline and every line streams; and
  it resets when the run id changes, so a second run's lines stream even without an unmount. Events
  are filtered by run id, so a stale frame from the previous run is never mistaken for the new one.
- **`ChatTrace` takes the run id** and passes it to the hook; `reveal` still gates the whole
  behaviour, so `ChatTurnTrace` (which passes neither) never animates. A live trace mounted with
  nothing on the wire yet renders an empty container rather than the history trace's
  "Nothing on the wire yet." line.
- **`ChatPage` mounts the live `ChatTrace` before the run's first event.** It tracks whether the
  run was seen starting while the screen was watching (`fromStart`, set by `run.started`, not by
  the resume effect) and mounts the trace then, with zero events. A run joined mid-turn — the
  resume path, where the persisted read has not landed at the moment `live` is set — still mounts
  only once its events are present, so its existing lines render whole, exactly as VS-433 promised.

## Out of scope

Trace content, grouping and VS-437's short file-name label. No scroll work.
