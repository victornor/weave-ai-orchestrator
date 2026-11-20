## Decisions

- **Measure from `ciHeadAt`, stored in `delivery`.** The supervisor poll already writes `ciHead` and
  detects its change; it now also writes `ciHeadAt` (ISO) = now when the head differs from the stored
  one, else the stored value. A row with no stored `ciHeadAt` (written before this change) gets `now`
  and is persisted, so its grace restarts once at deploy rather than reading as ancient.
- **Grace start = max(slotStartedAt, headObservedAt).** Slot age remains a lower bound so a head observed
  before the slot began cannot shorten the wait. `judgeMergeChecks` takes `headObservedAtMs` (optional;
  absent keeps old behaviour for callers without it).
- **What the alarm now means:** "the current head has had no checks for at least `mergeChecksAlarmSec`
  as seen by this daemon's polls." Observation lags creation by up to one poll interval, so the effective
  grace is slightly longer than the threshold, never shorter.
- **`needs:` queueing left alone:** unobservable in either repository, not guessed at.
