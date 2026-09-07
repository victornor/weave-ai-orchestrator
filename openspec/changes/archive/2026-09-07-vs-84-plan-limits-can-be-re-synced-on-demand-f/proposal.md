## Why

VS-34 gave the daemon an account probe and a five-minute supervisor poll; VS-73 fixed its launch;
VS-78 put the resulting snapshot in the conductor chat header. The number is therefore never worse
than five minutes old — but the workspace owner asked the obvious question ("how often are plan
limits resynced? can we add a manual sync button too?") because nothing on either surface answers
it, and because the moment you actually want the number is the moment you are about to start a long
turn, which is exactly when a four-minute-old snapshot is the one you have.

Every piece is already there: `accounts.refresh()` re-probes and replaces a snapshot, and both the
Usage view and the header sheet render `accountLimits()` over the stored rows. What is missing is a
way to ask for a probe, a guard so asking cannot become a way to spawn a CLI in a loop, and a plain
statement of how old the numbers are and how they got that way.

## What Changes

- **A manual sync re-probes one runtime, or every runtime the workspace spends on**, through
  `POST /w/:ws/usage/accounts/refresh` — next to the `GET /usage/accounts` it refreshes, because
  the snapshots are workspace state rather than part of the daemon-level runtime registry.
- **It is rate limited on the daemon**, one manual probe per workspace and runtime per 30 seconds.
  A request inside that window is not an error: it returns the current snapshot and says when the
  next sync is allowed, which is what a client needs in order to say so. Only manual syncs count
  against the window; the supervisor's own poll neither consumes it nor is blocked by it.
- **A manual sync reports a probe that failed**, per runtime, rather than returning the untouched
  previous snapshot and letting it read as fresh. The poll's behaviour is unchanged — it still
  swallows the failure and leaves the snapshot in place.
- **The plan-limits block gains a per-runtime "Sync now"**, which disables and spins while the probe
  is in flight and prints the reason underneath when it fails or is throttled. The block is the same
  component the chat header's detail sheet renders, so both surfaces get the control from one place.
- **The capture time is stated as a sync**, `synced 2m ago`, beside the numbers on both surfaces,
  and the block says in one line that the daemon also refreshes on its own every five minutes — the
  answer to the question that prompted the ticket.
- **`conductor usage --sync`** re-probes before printing, and prints what was synced, what was
  throttled and what failed.

## Capabilities

### Modified Capabilities

- `usage-plan-limits`: a new requirement for the on-demand sync — the route, the per-runtime rate
  limit and what a throttled request returns, the failure report a manual sync makes that the poll
  does not, and the `conductor usage --sync` flag. The usage-view requirement is modified so that
  the block states the snapshot's age as a sync, offers the control, and says what the automatic
  cadence is.
- `conductor-chat/session-limit`: the detail behind the header meter offers the same sync and shows
  the same age, so the surface that made the question urgent can answer it in place.

## Impact

- `packages/shared/src/types.ts` — `AccountSync`, `AccountSyncThrottle`, `AccountSyncFailure`.
- `packages/core/src/usage/accounts.ts` — the probe extracted from `refresh()` so `sync()` can reuse
  it and report per-runtime failures, `MANUAL_SYNC_INTERVAL_MS`, and the in-memory last-manual-sync
  map that enforces it.
- `packages/core/src/api.ts` — `AccountsService.sync`.
- `packages/server/src/routes/usage.ts`, `routetable.ts`, `docs/API.md` — the route.
- `packages/ui/src/api/{keys,hooks}.ts` — `useSyncUsageAccounts`, writing the returned snapshots
  straight into the `usageAccounts` cache so both surfaces update without a refetch.
- `packages/ui/src/components/PlanLimits.tsx` — the control, its pending and message states, the
  `synced …` label and the cadence line; prop-driven as it already is.
- `packages/ui/src/components/SessionLimit.tsx`, `routes/Chat.tsx`, `routes/Usage.tsx` — the wiring.
- `packages/cli/src/commands/usage.ts` — `--sync`.
- Tests: `packages/core/src/usage/accounts.test.ts`, `packages/server/test/usage.test.ts`,
  `packages/ui/src/test/{usage,sessionLimit}.test.tsx`, `packages/cli/src/usage-command.test.ts`.

## Out of scope

- Changing the automatic five-minute cadence, or making it configurable. The block states it.
- A sync from the TUI or from Telegram.
- Syncing a runtime the workspace does not spend on: the default set stays the one the poll uses.
