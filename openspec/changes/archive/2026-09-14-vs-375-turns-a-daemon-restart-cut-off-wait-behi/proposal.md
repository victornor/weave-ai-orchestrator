# Resume a restart's cut-off turns first, and say when they are queued for capacity

Tracker change for [VS-375](weave://tickets/VS-375). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

A clean restart on 2026-09-13 (down 23:35:32, back 23:40:08) cut off three worker turns. VS-339 did
its job: their wakes stayed `queued` to resume, with no retry card. But the dispatcher's candidate
order is `a.kind = 'weaver' DESC, a.last_run_at IS NULL DESC, a.last_run_at`
(`packages/core/src/runs/dispatcher.ts`), so a worker that has **never run** always sorts ahead of one
whose turn the shutdown cut off — the cut-off worker *has* run, so its `last_run_at` is set. At
`maxConcurrentRuns` (6) the weaver plus five brand-new workers took every slot first (VS-372 at 23:44)
while the three resumed turns kept waiting. The restart wake told the weaver only that the turns were
"interrupted", with nothing saying they were queued behind the run limit; the weaver read it as a
stall, relaunched all three (the relaunches merged into the same wakes) and filed a wrong incident.

## What changes

- **Resume cut-off turns first.** The dispatcher orders a worker whose latest run ended
  `interrupted_by_shutdown` ahead of never-run workers. The weaver still goes first, and everything
  else keeps the existing `last_run_at` fairness order.
- **Name the turns waiting for capacity.** The `daemon.restarted` wake payload gains a
  `queuedForCapacity` list: the interrupted turns that cannot start at once because the run limit
  (`maxConcurrentRuns`, less the weaver's own slot) or a project's `maxWorkers` is reached. The chat
  line and the weaver's instructions say to expect it, so the weaver relays the wait instead of
  relaunching or reporting a stall.
- **Relaunch is a no-op when a resume is already queued.** `weave_worker_relaunch` on a worker whose
  shutdown-interrupted wake is still `queued` returns a clear `notice` ("already queued; waiting for a
  run slot") and leaves the worker, its brief and its session alone, instead of looking like it
  started something.

## Out of scope

The shutdown classification and wake preservation themselves (VS-339, already shipped), the retry
ladder, and crash recovery (boot recovery's `interrupted` retry wakes are a different signal from the
`interrupted_by_shutdown` this ticket targets). No schema change.
