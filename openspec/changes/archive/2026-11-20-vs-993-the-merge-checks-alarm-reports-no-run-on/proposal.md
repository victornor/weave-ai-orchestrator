## Why

VS-991's `judgeMergeChecks` answers "no check is pending by name" with the *slot's* age against
`mergeChecksAlarmSec`. On 2026-11-20 at 18:26:58Z VS-985 alarmed "no run, all checks skipped or
cancelled" on head `235524da` whose `backend-tests` run was created two seconds earlier, with all seven
checks attached a second later. The daemon's own OpenSpec archive commit moves the head mid-landing, so
every landing passes through a head whose checks do not exist yet; the slot has by then been held past
the threshold, so the verdict is `no_run` on the first tick. That reads as "CI was never triggered",
a wrong diagnosis rather than a premature one.

## What Changes

- Track when the current head was first observed (`ciHeadAt`, in the ticket's delivery record, reset
  whenever the observed head changes). No new forge call: the supervisor already reads `headSha`.
- With an empty rollup, `no_run` requires the *current head* to have been observed without checks for at
  least `mergeChecksAlarmSec`. The grace is measured from the later of the slot start and the moment the
  head was first observed. A head first seen this tick is never `no_run`.
- A rollup that is non-empty but has nothing pending (all skipped/cancelled) is judged the same way.
- Not changed: a check `QUEUED` behind a `needs:` dependency still counts as not started after
  `mergeChecksAlarmSec`. No workflow in either repository uses `needs:`, and the rollup does not say why a
  check is queued, so closing it would mean guessing at behaviour that cannot be observed. Left as is.

## Capabilities

### Modified Capabilities
- `worker-supervision/merge-checks-alarm`: the "no check pending" rule is measured from the head's first observation.
