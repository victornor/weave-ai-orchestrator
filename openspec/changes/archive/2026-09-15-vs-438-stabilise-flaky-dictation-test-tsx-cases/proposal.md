# Stabilise the flaky dictation tests

Tracker change for [VS-438](weave://tickets/VS-438). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

On 2026-09-14 three workers each hit a one-off failure in
`packages/ui/src/test/dictation.test.tsx` during a full `pnpm test` run: the `VS-282` case
`pressing send while recording stops it and submits the transcript once it lands`, the `VS-195` case
`unlocks and shows the failure when transcription fails`, and one unnamed case. Each passed when run
alone and on a re-run.

Landing checks run the whole suite behind one merge slot, so a case that only fails under load can
turn an approved pull request's landing red and stall the queue. That is the failure mode this
change removes.

## What the cause turned out to be

Every `await` on the dictation upload path — the `/api/health` probe, `getUserMedia`, the
`POST /api/transcribe` call and the body it returns — settles on a **microtask**. The tests waited
for those with `@testing-library`'s `waitFor`, which polls on a **real timer** (50 ms, 1 s default
timeout). When the suite saturates the machine, the event loop can starve past that one-second
window even though the work has already finished, and the case fails for a reason that has nothing
to do with the code it tests.

Reproduced deliberately by running three full UI suites concurrently (a heavier version of the
landing slot): before the fix, `dictation.test.tsx` failed in 4 of 12 runs; the failures were the
`waitFor` timeout shape, and the whole run lost 3–10 cases to the same mechanism across other files.

A second, separate timing dependency sat in `dictation diagnostics > caps the log`: it drove 510
recognizer events through 510 separate `act()` calls, one React render each, which can exceed the
default 5 s test timeout under load.

## What changes

`packages/ui/src/test/dictation.test.tsx` only. No product code changes, so behaviour is identical.

- A local `eventually(assertion, turns)` helper waits for a condition by draining the microtask
  queue inside `act` — the bound is microtask turns, never the wall clock, so CPU load cannot make
  it late. Every `await waitFor(...)` in the upload path becomes `await eventually(...)`.
- The diagnostics-cap case drives its whole 510-event burst inside one `act`, so React batches it to
  a render or two instead of 510. Same cap behaviour, no timeout exposure.

The rebase onto main pulled in VS-435's auto-send tests, which are in the same file and used the
same real-timer `waitFor`; they are converted the same way, so the fix covers the file as it lands
rather than only the cases that existed when the ticket was filed.

## Out of scope

- Dictation features (VS-432, VS-435) and any product behaviour change.
- The unrelated load-sensitive cases this investigation also surfaced in
  `packages/ui/src/test/knowledge.test.tsx` and `packages/ui/src/test/globalMap.test.tsx`; they are
  not this ticket's subject and are reported on the ticket rather than fixed here.