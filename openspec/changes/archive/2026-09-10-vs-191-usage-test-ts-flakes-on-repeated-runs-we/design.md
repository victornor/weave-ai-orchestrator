## Context

`packages/core/src/usage/service.ts`'s `range()` (line 143) resolves a query window by calling
`resolveUsageWindow(q.window, q.grain, new Date(), ...)` — `new Date()` is evaluated fresh, at the
moment the query runs. For `window: '24h'` (and `'today'`, `'week'`, `'7d'`) the resolved `end` is
that same `new Date()`, serialized to millisecond precision (`usage.ts:22`, `toISOString()`). The
SQL boundary in `rawRows()`/`top()`/`models()` (`service.ts:148,208,236`) is `u.occurred_at >= ? AND
u.occurred_at < ?`, i.e. the upper bound is exclusive.

`packages/core/src/usage/usage.test.ts`'s `usage top / models / ticket` describe block has three
tests (`groups by model and ticket with human labels, ordered by cost`, `groups ticket-less usage per
agent instead of one unknown bucket`, `aggregates per model with provider`) that need their rows to
fall inside a real, live `window: '24h'` (unlike the rest of the file, which anchors on the fixed
`DAY = '2026-01-05'` constant via `window: 'custom'` with an explicit `start`/`end`, sidestepping real
time entirely). They capture `const when = nowIso()` and insert rows at `occurredAt: when`, then
immediately call `usage().top(...)`/`usage().models(...)`.

**Root cause**: `nowIso()` (`packages/db/src/db.ts:96`, `new Date().toISOString()`) and the query's
internal `new Date()` are both millisecond-precision, and the insert-then-query sequence in these
tests executes in well under a millisecond of wall-clock time in practice. When both calls land in
the same millisecond, `when === end` exactly, and the strict `<` comparison excludes every rows whose
`occurred_at` equals `end`. Reproduced locally: 12-14 of every 15 runs of `usage.test.ts` alone fail
one or more of these three tests, each time with an empty or under-counted result — never a wrong
value, always a dropped-row shape, confirming the boundary-tie theory (verified by running the file
15-20 times in a row and observing only these three cases fail, always with `[]`/reduced totals,
never a different but internally-consistent wrong answer).

This is a race against real time inside the test, not a bug in what is being asserted: the same
insert-then-query sequence, run a few milliseconds apart, produces the correct result every time.

## Goals / Non-Goals

**Goals:**
- Make the three affected tests pass deterministically on 20+ consecutive runs of the file alone and
  3+ consecutive full-suite runs, per VS-191's acceptance criteria.
- Keep every existing assertion exactly as strict as it is today — this is not a case of an
  over-specified assertion; the assertions were always correct, they were just racing real time.

**Non-Goals:**
- Changing `packages/core/src/usage/service.ts`'s window boundary semantics (e.g. `<` vs `<=`). The
  same tie can in principle occur in production (a usage query issued in the same millisecond as a
  usage event is recorded), but that is a separate, much rarer, and behaviorally different question —
  whether a `'24h'`/`'today'`/`'week'` window's upper edge should be inclusive of the instant the
  query runs — with its own tiling trade-offs against `'yesterday'`'s exclusive end (which shares its
  boundary with `'today'`'s start). Fixing that is out of scope for a ticket about test determinism;
  flagged separately, not implemented here.
- Adding a general injectable clock to `WorkspaceContext`/`UsageService`. No other test needs one
  today, and `resolveUsageWindow`'s existing `now` parameter (`packages/shared/src/usage.ts:6`) is
  already an unused seam for exactly this purpose if a future test needs it directly.

## Decisions

**Freeze time in the three affected tests with `vi.useFakeTimers()` / `vi.setSystemTime()`, then
advance the frozen clock forward before querying.** This is the repo's established idiom for this
exact class of problem — already used for the same reason in the sibling
`packages/core/src/usage/accounts.test.ts:149,194,199` and in
`packages/core/src/pull-requests/pull-requests.test.ts`, `packages/core/src/tickets/tickets.test.ts`,
`packages/core/src/supervisor/supervisor.test.ts`. Concretely, for each of the three tests:

1. `vi.useFakeTimers(); vi.setSystemTime(<fixed instant>);`
2. Capture `when = nowIso()` (now deterministic) and insert rows via `add({ occurredAt: when, ... })`.
3. `vi.setSystemTime(<fixed instant + 1000ms>)` before calling `usage().top()`/`usage().models()`, so
   `range()`'s internal `new Date()` resolves to a value guaranteed to be 1 full second after every
   row's `occurred_at` — never a tie, on every run, on every machine.
4. `vi.useRealTimers()` in `afterEach` (matching the existing sibling pattern), alongside the file's
   existing `h?.cleanup()`.

**Considered and rejected**: relaxing the boundary check to `<=` in production code. Rejected for this
ticket because (a) it is a production behavior change with its own tiling trade-offs against
`'yesterday'`, unrelated to what VS-191 asks for, and (b) the acceptance criteria's preference for
"tightening the code's guarantee" applies when an assertion was *over-specified*; here the assertions
were correct throughout — the test's own timing was the nondeterministic input, so the fix belongs in
the test, not the assertions or the boundary semantics.

**Considered and rejected**: keeping `nowIso()`/real time and asserting a looser property (e.g. "no
error thrown" or unordered `toContain` checks). Rejected — this is exactly the "widen the assertion
until it always passes" anti-pattern the ticket explicitly forbids, and it would weaken real
regression coverage for no reason, since the underlying race is fully avoidable.

## Risks / Trade-offs

- Fake timers must be installed and torn down correctly per test (`afterEach`) or they would leak into
  later tests in the same file/process; the existing sibling tests in this repo already establish the
  safe pattern to follow, and `afterEach` here already runs `h?.cleanup()`, so the timer teardown is
  added alongside it.
- This does not fix the theoretical production-code tie window described in Non-Goals. That is a
  separate, distinct question raised in this ticket's PR description for the conductor to route if it
  is worth pursuing.
