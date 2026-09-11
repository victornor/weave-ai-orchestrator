## Context

See `proposal.md` — Why, and VS-261's report (`ac_ticket_document_get VS-261 report`) for the full
evidence trail: the empirical process/pipe experiment, the per-adapter cancellation shape, and why a
detached host is the wrong fix. This document only covers the choices this change itself makes.

Three restart paths funnel into the same two low-level primitives, which is what makes one fix cover
all three without touching each caller's own logic:

1. `daemon upgrade|restart|rollback` (`packages/cli/src/commands/daemon.ts`'s `drainAndRestart`):
   already calls `POST /api/daemon/drain` with an operator-chosen `timeoutSec` (CLI default 900)
   *before* sending any kill signal, then either `systemctl --user restart` or `stopDaemon()`.
2. The deferred `update apply` pipeline (`packages/server/src/upgrade.ts`'s `waitForIdle`, then
   `packages/cli/src/upgrade-runner.ts`'s `restartCommand()`): waits up to `daemon.upgrade.waitForIdleSec`
   for the dispatcher to go idle, then proceeds to build/switch regardless, then restarts via the same
   `systemctl --user restart` / `stopDaemon()` pair as (1).
3. `daemon stop`, a `systemctl --user stop`, a host reboot, a plain `kill`: no HTTP drain call at all,
   straight to `SIGTERM`/`SIGINT` → `shutdown()`.

All three end in either `stopDaemon()`'s `SIGTERM`-then-`SIGKILL(timeoutMs)` or the systemd unit's own
`TimeoutStopSec`-bounded stop. Fixing `shutdown()` itself (so it always exits gracefully within a
known, bounded time) and raising those two kill timeouts to comfortably exceed that bound fixes all
three paths at once, without adding drain logic to (2), which does not call `/api/daemon/drain` today
and is out of scope to change here.

## Goals / Non-Goals

**Goals:**
- `shutdown()` always exits within a known, bounded wall-clock time, whether it was reached via a
  graceful HTTP-mediated restart or a bare `kill -TERM`.
- A turn still running when that bound is reached is cancelled through the exact path
  `/runs/:id/cancel` already uses (`runs.cancel(actor, id, 'interrupt')`), not abandoned.
- The kill timeout that can follow `shutdown()` (`stopDaemon`, systemd) never fires before
  `shutdown()`'s own bounded work would have finished on its own.
- `POST /api/daemon/drain`'s existing 180s-default, CLI-overridable-to-900s budget keeps meaning what
  it already means to an operator: draining stops there, not "reported as still running and then
  raced against a much shorter kill timeout."

**Non-Goals:**
- Changing the deferred `update apply` pipeline's own `waitForIdleSec`/idle-wait logic
  (`packages/server/src/upgrade.ts`). It already reduces to the same two kill primitives this change
  fixes; nothing in this ticket asks for a second drain mechanism there.
- Making the kill timeout dynamically reflect a human's one-off `--drain-timeout` choice at the moment
  of restart. See Decision 2 for why that turned out to be unnecessary.
- Any change to `spawnLines`'s own cancel/escalation timings (`packages/runtime-sdk/src/process.ts`) —
  its existing interrupt→30s-SIGKILL escalation is treated as a fixed constant this change budgets
  around, not something to retune.

## Decisions

### 1. `shutdown()`'s drain is bounded in two stages: a natural-drain window, then a cancel-and-wait window — run concurrently across workspaces, not per-workspace inside a serial loop

`shutdown()` iterates workspaces with a plain `for...of` today, and every step inside that body —
`channels.stop()`, `webhooks.stop()`, `dispatcher.stop()`, `tickets.stop()`, `jobs.stop()`,
`supervisor.stop()`, `cancelRunningRuns()` — is `await`ed before moving to the next workspace. A
per-workspace bound of `SHUTDOWN_DRAIN_GRACE_MS + SHUTDOWN_CANCEL_GRACE_MS` is therefore not the
shutdown's total bound; it is multiplied by however many workspaces are registered, since the loop
does not start workspace *N+1*'s bounded wait until workspace *N*'s has already finished. That
operator-configured count is not something `SHUTDOWN_KILL_GRACE_MS` can size against — three
workspaces already triples it, past the constant this design otherwise treats as fixed.

The fix is to stop workspaces **concurrently**, not to make the constant depend on workspace count.
The `db.close()` loop already runs as a *separate* pass after every workspace's stop sequence has
finished (`packages/server/src/daemon.ts:172`, its own `for` loop, after the `Promise.all` that closes
the two listeners) — so nothing about workspace A's shutdown sequence depends on workspace B's; the
ordering that matters (`channels` → `webhooks` → `dispatcher` → `tickets` → `jobs` → `supervisor` →
`cancelRunningRuns`) is entirely *within* one workspace's own body, never *between* workspaces. That
makes `Promise.all` over the per-workspace bodies safe:

```ts
// packages/server/src/daemon.ts
await Promise.all([...new Set(workspaces.values())].map(async (ws) => {
  await ws.channels?.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'channel manager stop failed'));
  await ws.webhooks?.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'webhook dispatcher stop failed'));
  let drained = await ws.services.dispatcher.stop(SHUTDOWN_DRAIN_GRACE_MS).catch(() => false);
  if (!drained) {
    log.warn({ ws: ws.id }, 'drain grace period exhausted; cancelling running turns');
    await cancelRunningRuns(ws);
    drained = await ws.services.dispatcher.stop(SHUTDOWN_CANCEL_GRACE_MS).catch(() => false);
    if (!drained) log.warn({ ws: ws.id }, 'a cancelled turn did not finish within the shutdown grace period; continuing to close anyway');
  }
  await ws.services.tickets.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'ticket follow-up drain failed'));
  await ws.services.jobs.stop().catch((e: unknown) => log.warn({ err: e, ws: ws.id }, 'job log drain failed'));
  try { ws.services.supervisor.stop(); } catch (e) { log.warn({ err: e, ws: ws.id }, 'supervisor stop failed'); }
  await cancelRunningRuns(ws);
}));
```

With this, `SHUTDOWN_DRAIN_GRACE_MS + SHUTDOWN_CANCEL_GRACE_MS` is the total shutdown bound regardless
of how many workspaces are registered — the property Decision 2's arithmetic requires, and does not
have with the serial loop. This was flagged in review: a daemon with three registered workspaces
(`fern-services`, `fern-ofm`, `sideprojects`, the plan-approval comment's own count) would need 675s against
a 255s `SHUTDOWN_KILL_GRACE_MS` under the serial version — the exact failure this ticket removes,
reached by a different route, on the second and third workspace, and harder to notice because the log
would show a drain that looked like it was working on the first one.

Alternative considered: one global deadline shared across the (still serial) loop, so each workspace
gets whatever time remains from a single clock rather than a fresh budget each. Rejected: an unlucky
workspace late in iteration order could receive close to zero natural-drain time if earlier workspaces
consumed the whole budget, which trades a predictable bug for an unpredictable one — a workspace's
grace period would depend on load elsewhere in the daemon and on iteration order (a `Set` over a
`Map`'s values, effectively insertion order), neither of which is a property worth defending.
Concurrent draining gives every workspace the same two fixed windows regardless of what else is
happening, which is both simpler to implement and simpler to reason about.

Alternative considered: scale `SHUTDOWN_KILL_GRACE_MS` by the number of registered workspaces.
Rejected, matching the concern raised in review: the unit file cannot know that count at install time,
and a kill timeout that grows without bound as workspaces are added is not a fix, it is a deferral of
the same bug to whatever a future large workspace count would multiply out to again.

The existing unconditional `cancelRunningRuns(ws)` call at the end of each workspace's body (after
`tickets.stop()`/`jobs.stop()`/`supervisor.stop()`) is left in place as the final safety net it already
is — it covers any run the DB shows as `running`/`queued` that the dispatcher's own `inflight` set does
not know about, and is a cheap no-op once the two stages above have already emptied it.

Two stages, not one, because cancelling and finishing are different waits: `entry.cancel('interrupt')`
(`spawnLines.cancel`, `packages/runtime-sdk/src/process.ts:54`) resolves almost immediately — it sends
`SIGINT` to the process group and returns — but the run's own promise (what `dispatcher`'s `inflight`
set actually awaits) only settles once the child process exits and `finalize()` runs, which can take
up to `spawnLines`'s own internal 30s SIGINT→SIGKILL escalation. `SHUTDOWN_CANCEL_GRACE_MS` has to
cover that escalation with margin, or the run's `interrupted` status frequently fails to land before
`shutdown()` moves on — which would silently reproduce this ticket's own bug in miniature (acceptance
criterion 4 specifically asks for the interrupted run to be *recorded*, not just signalled).

If a cancelled run still has not finalized after `SHUTDOWN_CANCEL_GRACE_MS`, `shutdown()` proceeds
anyway (closes listeners/db) rather than waiting further — its process has already been sent `SIGINT`
and (per `spawnLines`'s own escalation) will receive `SIGKILL` from that timer regardless of whether
this daemon process is still alive to see it finish. If the daemon exits before that run's `finalize()`
lands, its DB row is left `running`; `bootRecovery` (`packages/core/src/supervisor/index.ts:138`)
already treats a `running` row found at boot as an orphan, kills any surviving process by pgid, marks
it `interrupted`, and re-queues the turn — the same safety net that already covers a true crash. This
is the accepted residual: a on-time `interrupted` record in the common case, a same-outcome record one
boot later in the rare case where cancellation itself did not finish inside its own grace window.

Alternative considered: a single, larger bound instead of two stages. Rejected — collapsing them loses
the distinction between "still doing useful work, worth waiting for" and "already told to stop, only
waiting for the OS to catch up," and would need to be sized for the *sum* of both concerns anyway,
which is what two named constants already express more legibly.

### 2. The kill timeout does not need to know the operator's chosen drain budget at request time

The ticket flags this as an open design question: `TimeoutStopSec` is a static file, so "a value
chosen at request time may need a different mechanism than the unit alone." It turns out not to,
once (1) above holds: for every path that calls `POST /api/daemon/drain` first (`restart`, `upgrade`,
`rollback`, and — after this change — `stop`), the operator's chosen budget (`timeoutSec`, CLI default
900s) is spent entirely *before* any kill signal is sent, and the route now cancels whatever is still
running when that budget expires (Decision 3). By the time `SIGTERM` actually lands, `shutdown()` only
ever needs its own small, fixed bound to finish up — regardless of how large the operator's own
pre-drain budget was. So the kill timeout's job is narrower than "respect whatever budget was granted"
literally: it only has to outlast `shutdown()`'s own fixed worst case — a constant the code controls
directly, not a value that arrives with the request, **and not a value that scales with anything an
operator configures, including how many workspaces are registered** (Decision 1's move to concurrent
per-workspace draining is what makes that last part true; the serial loop this ticket found would have
made the "fixed worst case" claim false).

```ts
// packages/shared/src/daemon-shutdown.ts (new)
export const SHUTDOWN_DRAIN_GRACE_MS = 180_000;   // matches /api/daemon/drain's own 180s default
export const SHUTDOWN_CANCEL_GRACE_MS = 45_000;   // covers spawnLines' 30s interrupt->SIGKILL escalation, plus margin
export const SHUTDOWN_KILL_GRACE_MS = SHUTDOWN_DRAIN_GRACE_MS + SHUTDOWN_CANCEL_GRACE_MS + 30_000; // 255_000
```

- `packages/cli/src/daemon.ts`'s `stopDaemon(timeoutMs = SHUTDOWN_KILL_GRACE_MS)` — was `10_000`.
- `packages/cli/src/daemon.ts`'s `renderServiceUnit()` emits `TimeoutStopSec=255` — was the literal `30`.

This is why the "different mechanism than the unit alone" turns out to be: none needed, once the unit
file's own static number is simply large enough for `shutdown()`'s fixed bound rather than for
whatever an operator might one day pass to `--drain-timeout`. Re-running `daemon install-service`
after a future change to these constants is how the installed unit picks up a new value — the same as
any other change to `renderServiceUnit()`'s output today.

Alternative considered: a per-request `systemctl --user set-property --runtime <unit>
TimeoutStopSec=<n>` immediately before `systemctl --user restart`, so the unit's own timeout could
track an operator's one-off `--drain-timeout` exactly. Rejected: this repo's test suite has no real
systemd instance to verify the property is actually honored at runtime for `TimeoutStopSec`
specifically (as opposed to the small set of resource-control properties `set-property` is
unambiguously documented to support), and getting this wrong silently reintroduces exactly the bug
this ticket exists to fix. A fixed, generous constant is verifiable as a pure function
(`renderServiceUnit`'s output) and does not depend on a runtime systemd behavior nobody here can check.

Alternative considered: derive the kill timeout from the caller's own `drainTimeoutSec` (e.g.
`drainTimeoutSec * 1000 + buffer`) at each call site instead of a fixed constant. Rejected as
unnecessary once Decision 1 holds: it would make the kill timeout enormous for a 900s `--drain-timeout`
even though `shutdown()` itself never needs that long once the pre-drain call has already run — and it
would leave `daemon stop`'s raw-signal cousins (a plain `kill`, a reboot, `systemctl --user stop`
without going through the CLI's own drain step) with no comparable number to derive from at all, since
nothing chose a budget for those. A fixed constant covers every path uniformly.

### 3. `POST /api/daemon/drain` cancels on its own timeout instead of only reporting

```ts
// packages/server/src/routes/daemon.ts
app.post('/daemon/drain', async (c) => {
  const { timeoutSec } = await body(c, z.object({ timeoutSec: z.number().int().min(0).max(3600).default(180) }));
  const all = uniqueWorkspaces(deps);
  await Promise.all(all.map(async (w) => {
    const drained = await w.services.dispatcher.stop(timeoutSec * 1000).catch(() => false);
    if (!drained) await cancelRunningRuns(w).catch(() => undefined);
  }));
  const running = all.flatMap((w) => {
    try { return w.services.runs.list({ status: ['running', 'queued'] }).items.map((r) => ({ workspace: w.id, runId: r.id })); } catch { return []; }
  });
  return c.json({ drained: running.length === 0, running, workspaces: all.map((w) => w.id) });
});
```

`cancelRunningRuns` (today a private function in `packages/server/src/daemon.ts`) is exported so this
route can call the same implementation `shutdown()` uses, rather than a second copy. `dispatcher.stop`
becomes the one bounded primitive both call sites share (Decision 4), which also removes the route's
existing `Promise.race` against its own `setTimeout` — a construct that left the underlying
`dispatcher.stop()` call (and its unbounded `drain()`) running in the background, uncancelled, after
the HTTP response had already gone out. That was harmless (nothing waits on it) but was never doing
anything the bounded `stop()` doesn't now do directly.

The response shape is unchanged (`{ drained, running, workspaces }`); `running` on a timeout now means
"was still running when the budget ran out, and has just been told to stop" rather than "was still
running and will shortly be handed nothing but a closed pipe" — which is what the CLI's own existing
message (`"N run(s) were still going and got interrupted; they resume on their own"`,
`packages/cli/src/commands/daemon.ts:259`) already claimed. This change makes that claim true instead
of aspirational; no CLI-side wording changes.

### 4. `Dispatcher.stop()` grows an optional bounded-timeout form

```ts
// packages/core/src/api.ts
export interface Dispatcher { tick(): Promise<void>; start(): void; stop(timeoutMs?: number): Promise<boolean>; running(): number }
```

```ts
// packages/core/src/runs/dispatcher.ts
async stop(timeoutMs?: number): Promise<boolean> {
  state.stopping = true;
  if (timer) { clearInterval(timer); timer = null; }
  if (timeoutMs === undefined) { await dispatcher.drain(); return true; }
  let timedOut = false;
  let handle: NodeJS.Timeout;
  await Promise.race([
    dispatcher.drain(),
    new Promise<void>((r) => { handle = setTimeout(() => { timedOut = true; r(); }, timeoutMs); }),
  ]);
  clearTimeout(handle!);
  return !timedOut;
}
```

Backward compatible: every existing caller that calls `.stop()` with no argument (`unregister`, the
various tests) keeps today's unbounded-wait behavior and gets `Promise<boolean>` back, which nothing
existing reads. Calling `stop()` twice in a row (as `shutdown()`'s two-stage sequence in Decision 1
does) is safe: `state.stopping = true` and clearing the timer are already idempotent, and racing
`drain()` against a fresh timeout each time is exactly the bounded-wait behavior wanted for the second
stage.

Alternative considered: keep `stop()` as-is and add a separate `stopBounded(timeoutMs)` method.
Rejected — every caller of today's `stop()` (`shutdown()`, the drain route, `unregister`) wants "stop
dispatching, then wait (bounded or not) for what's in flight," so a second method would just be `stop`
with extra steps; an optional parameter is the smaller surface.

## Risks / trade-offs

- **A turn that is neither interrupt-friendly nor killed within `SHUTDOWN_CANCEL_GRACE_MS`** (e.g. a
  runtime that ignores `SIGINT` and only dies to `SIGKILL`, which `spawnLines`'s own escalation timer
  sends at the 30s mark) still delays `shutdown()`'s exit slightly past the cancel grace period in the
  worst case, though never past `SHUTDOWN_KILL_GRACE_MS` (the external backstop). This is bounded, not
  eliminated — matching the ticket's own scope, which explicitly leaves the true crash/hang case to
  `bootRecovery`.
- **The systemd unit's `TimeoutStopSec` only updates for daemons reinstalled after this change ships**
  (`conductor daemon install-service`). An already-installed unit keeps its old `TimeoutStopSec=30`
  until reinstalled. This is inherent to a static unit file (Decision 2) and is called out in the
  ticket description itself; it is not silently swallowed here — the delivery report should say so
  explicitly, since it is a one-time manual step for the human running this daemon.
- **`TimeoutStopSec=255` on a user unit means a host reboot can stall for over four minutes** waiting
  for this daemon to stop, on a reboot that happens to catch a workspace mid-turn — the same 255s
  applies to every stop of the unit, not only an operator-initiated `daemon restart`/`upgrade`, because
  systemd has no way to distinguish why it is sending `SIGTERM`. This is a deliberate trade — choosing
  not to destroy in-flight work over choosing a fast reboot — but it is a machine-level consequence of
  a daemon-level decision, and the person rebooting this machine (captain, not necessarily whoever
  approves this change) may not expect it. This change does not special-case the reboot path: systemd
  gives no signal distinguishing a reboot-triggered stop from any other, so doing so would need a
  separate, more complex mechanism (e.g. a `StopWhenUnneeded`-style shutdown hook probing
  `systemd-inhibit`/`/run/systemd/shutdown` for a pending reboot) for a difference in degree, not kind,
  from the restart case this change is already built to handle well. Flagged here and in the delivery
  report per review; a shorter reboot-specific bound is a reasonable follow-up if it turns out to
  matter in practice, not something this change should guess at pre-emptively.
