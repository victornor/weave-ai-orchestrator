## Context

See `proposal.md` — Why for the full account. In short: `packages/ui/src/lib/stickToBottom.ts`
already has a `ResizeObserver`-driven re-pin (added by VS-79, lines ~171-196) meant to catch exactly
the late-height-growth case this ticket describes. This investigation drove that mechanism directly
in real headless Chromium — not jsdom, which stubs `scrollIntoView` as a total no-op — using a minimal
standalone page that copies the hook's actual scroll/observer logic, driven over CDP via Node's native
`WebSocket` (no puppeteer in this repo). Three runs:

1. A message starting at 20px growing to 220px 300ms after the follow scrolled to it (image/code-block
   landing late): ends `atBottom: true`.
2. Six messages, 80px each, appended 60ms apart (faster than any one smooth scroll completes):
   ends `atBottom: true`.
3. A message growing mid-animation with no further signal after: ends `atBottom: true`.

The full event log for all three shows the `ResizeObserver` firing within ~1ms of each height change
and immediately re-issuing an instant `scrollIntoView`, in every case landing exactly at
`scrollHeight - clientHeight`. This is real evidence, not a proof of absence — a production device may
differ in ways a synthetic page cannot capture (memory pressure delaying the observer callback, a
runtime that mutates an existing event's payload rather than appending a new one, an interaction with
the pinned decision area's resize that this harness did not model exactly) — which is exactly why this
change ships a diagnostic recorder instead of asserting the investigation is exhaustive.

Separately, and independent of whether the above mechanism is actually where the bug lives:
`packages/ui/src/test/chat.test.tsx:219` sets `window.HTMLElement.prototype.scrollIntoView = vi.fn()`
and every scroll test in that file (including the ones VS-63 and VS-79 added) asserts only
`scrolls()` — a call count — never a final position. That gap is real regardless of root cause.

## Goals / Non-Goals

**Goals:**
- Close the test-fidelity gap: assert the list's simulated position after a scroll, not just that
  `scrollIntoView` was called.
- Add two regression tests for the specific late-growth and rapid-burst conditions this investigation
  drove in a real browser, so a future change that breaks the geometry re-pin is caught in CI even
  though it currently isn't.
- Ship a zero-cost-when-off diagnostic recorder so the next occurrence produces a real sequence
  instead of another round of guessing.

**Non-Goals:**
- Changing `stickToBottom.ts`'s actual scroll/follow/geometry logic. No confirmed defect was found in
  it; changing it without one is the guess this ticket explicitly asks not to repeat.
- A UI affordance for diagnostics (a button, a settings toggle). Out of scope per the ticket
  ("redesigning the chat... or the scroll-to-bottom control"), and unnecessary: this is a devtools-era
  tool for a technical user (captain), not an end-user feature.
- Reproducing on the phone-keyboard path (`workspace-navigation/phone-keyboard-viewport`). That
  mechanism's own test suite already asserts real geometry-change scenarios with the position-tracking
  fakes; this investigation's real-browser testing did not implicate it, and the ticket scopes this
  change to conductor chat generally, not to re-litigating VS-79.

## Decisions

**Diagnostics as a capped in-memory ring buffer, gated by `localStorage`, not a network call.**
A `scrollDiagnostics.ts` module holds the last N (300) samples in a module-scope array, guarded by a
single check (`localStorage.getItem('ac:scroll-diag') === '1'`) read once at module load. When off,
the record function is a no-op returning immediately — no allocation, no timestamp read. Captain
enables it from devtools (`localStorage.setItem('ac:scroll-diag', '1')`, reload), reproduces the
bug, then reads `window.__acScrollDiagnostics()` (returns the buffer as a plain array, easy to
`copy()` in devtools) and pastes it into a ticket comment. No new UI, no server round trip, no
retention concern (in-memory only, gone on reload) — appropriate for a captain-only diagnostic tool
rather than end-user telemetry.

Alternative considered: send samples to the daemon as a new event/log type. Rejected — this is a
one-off diagnostic for a single suspected device-specific bug, not a feature; a server round trip
adds surface area (a new route, a retention policy, a privacy question) for something that should be
deleted once the bug is found.

**Record at the three existing measurement points, not by re-deriving state.**
`stickToBottom.ts` already computes exactly the values worth recording (in `onScroll`, in the
content-follow effect, and in the geometry `pin()` callback). The diagnostic call is one line at each
of those three points, passing an `event` label and the already-in-scope values — no new
measurement, no new listener, so it cannot itself change scroll behavior or add a race.

**Strengthen the `chat.test.tsx` fake instead of adding a parallel one.**
The existing `scrollable()` helpers already stage fake `scrollHeight`/`clientHeight`/`scrollTop`
getters/setters keyed to a `top` closure variable. Changing `window.HTMLElement.prototype.scrollIntoView`
from `vi.fn()` to a function that reads the target's simulated position and moves the *scrolling
ancestor's* `top` accordingly turns every existing call-count assertion in that file into a real
position assertion for free, and is the minimal change that closes the gap named in the proposal.

## Risks / Trade-offs

[The strengthened `scrollIntoView` fake changes behavior for every existing test in `chat.test.tsx`,
not just new ones] → run the full file after the change; a test that only ever asserted call count
should still pass since a correct implementation still ends up at the bottom. A test that was passing
by coincidence (call happened, position was never checked) is exactly what this change means to catch
— if one now fails, that is the gap surfacing, not a regression to route around.

[Diagnostics enabled and forgotten, silently costing a check on every scroll event] → the module-load
`localStorage` read is one string comparison; documented in the module's own doc comment as
captain-only and meant to be turned back off. No cost is added when off, so leaving it off by default
is the only guard needed.

[The real-browser investigation did not reproduce the bug, so this change cannot include the
acceptance criterion's "test that fails before the fix and passes after" for the reported failure
itself] → named explicitly in the PR per the ticket's own fallback instructions; the two new
regression tests instead assert the invariant this investigation *did* verify holds, which is real
coverage even though it is not a reproduction of the reported bug.
