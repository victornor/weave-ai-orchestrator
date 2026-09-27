## Context

See proposal.md for why. Global Live has no `WorkspaceProvider`. `V2Shell` holds one daemon-wide `GlobalEventStream` via `FanInStreams`. Live's cards come from `useWorkersMany` (`qk.workers`). `main.tsx` sets `refetchOnWindowFocus: false` and `staleTime: 10_000`, so returning to the window does not refetch. Recovery is the stream.

VS-641 already put a named `heartbeat`, `SseWatchdog` (stale ~30s, dead ~37.5s), `visibilitychange` pause/resume, `online`, a timer-gap `onWake`, and `resync()` on reconnect into both `useLiveStream` and the class streams (`EventStream`, `GlobalEventStream`). That code is in the release captain is running. The cause of the remaining stall is unproven; apply starts by reproducing it.

Two code facts are already true and shape the fix:

- `GlobalEventStream` resyncs only `seen` workspaces. `seen` is filled in `handle()`. A `heartbeat` listener only calls `watchdog.touch()`, so an idle stream never marks a workspace seen. Live loaded its workers by REST. A reconnect with an empty cursor is `GET /api/events` with no `after`, which starts at the current tail, so the gap is not replayed and not refetched.
- Wake today is only `visibilitychange`, `online`/`offline`, and a `setInterval` tick whose elapsed time overran. There is no `pageshow`, Page Lifecycle `resume`, or `focus` listener. A hidden document stops the watchdog, so a backgrounded tab recovers only if `visibilitychange` back to visible fires. A visible tab whose timers were frozen recovers only if the next tick fires and sees the gap.

`useConnection()` on a page with no workspace context returns a hardcoded `connected`. Live does not mount `ConnectionBanner`. Rule that in or out during reproduction; do not treat it as the fix unless the page is showing a fresh connected state while the data is old.

## Goals / Non-Goals

**Goals:**

- Reproduce against a scratch daemon in a real browser, and record which of the three cases stall.
- Fix the confirmed mechanism in the shared lifecycle (`useLiveStream`, `EventStream`, `GlobalEventStream`), not in Live alone.
- Close the unseen-workspace resync hole: a reconnect refreshes every workspace whose reads the document already holds.
- A regression test that fails on the current code for that mechanism.

**Non-Goals:**

- Turning `refetchOnWindowFocus` back on as the fix. Focus refetch would paper over a dead stream and is not what the ticket asked for.
- An extra SSE connection per stream, or holding a connection while the document is hidden.
- Starting or stopping the live daemon or its systemd unit. Scratch daemon only (`scripts/scratch-daemon.sh`), loopback port other than 7433, isolated `AC_CONTEXTS_FILE`.
- Guessing a second mechanism and shipping it because it is plausible. A candidate reproduction ruled out is not implemented.

## Decisions

1. **Reproduce before editing stream code.** The ticket is deep because the obvious fix shipped and missed. A jsdom test of the current watchdog passes and does not reproduce captain's stall. Drive the real Live page in a real browser against a scratch daemon. Try, in order: background the tab past 40s and return; a large timer gap (sleep, or a throttled-timer stand-in the browser actually does); a visible tab left idle past 40s. For each, record connection state, whether a new `EventSource` opened, whether worker queries refetched, and that a reload is current while the page is not. Screenshots of the stall and of the post-fix recovery (light and dark) go in the home directory, attached to the ticket, not under `work/`.

2. **Implement only the mechanism the reproduction confirms, plus the unseen-workspace resync hole.** The hole is not a guess: the code skips `resync` for a workspace that has not emitted, and Live is that case. It is necessary whenever a reconnect happens before the first durable event. It is not sufficient if the resume path never runs. If reproduction shows the watchdog or `visibilitychange` never fires, add the signal that does fire (`pageshow` with `persisted`, Page Lifecycle `resume`, or `focus`) in the same three lifecycles, and keep the hidden-document close. Do not add a signal the reproduction did not need.

3. **One behavior, three copies.** `useLiveStream`, `EventStream` and `GlobalEventStream` each own an `EventSource` and a `SseWatchdog`. A fix that lands in only one of them leaves run/job streams or the workspace stream stale. Share the wake and resync rule; do not add a fourth connection.

4. **The regression test drives the confirmed mechanism.** If the hole is the cause, a `GlobalEventStream` that has opened, received only a heartbeat, and reconnects must invalidate `qk.workers` for a workspace whose reads are already cached, even with an empty cursor. If the cause is a missing wake, the test fires that signal (not a hand-advanced interval that the current watchdog already handles) and asserts a reconnect plus resync. The test must fail on the pre-fix code. Do not assert that a call happened without asserting the reads moved.

5. **Hidden stays closed.** VS-227: `document.hidden` closes the socket and stops the watchdog. A new wake signal must no-op while hidden. `connectionBudget.test.tsx` stays green: still one daemon-wide connection per document.

## Risks / Trade-offs

- [Real-browser reproduction does not stall in any of the three cases] → Record what was tried and for how long. Do not invent a fix. `weave_ask` with `kind: "concern"` naming the attempts and what would unblock (a capture from captain's own browser, or a longer window).
- [jsdom fires `visibilitychange` and timers faithfully, so a test of those paths stays green while Chromium does not] → The regression test must encode the signal or the resync gap the browser reproduction actually showed, not the path the current tests already cover.
- [Closing the unseen-workspace hole refetches worker lists on every reconnect] → Same set `resync` already refetches, once per reconnect, not per heartbeat. No new connection.
- [A `focus` listener reconnects on every alt-tab] → Only add `focus` if reproduction shows it is the signal that fires when the others do not, and only reconnect when the socket is not known-fresh (no frame inside the watchdog window).

## Migration Plan

No data migration. The running daemon picks this up on the next upgrade after merge. Rollback is reverting the stream-lifecycle change; no schema.

## Open Questions

None that change the specs. Which of the three cases reproduces is an apply-time measurement, not a planning choice.
