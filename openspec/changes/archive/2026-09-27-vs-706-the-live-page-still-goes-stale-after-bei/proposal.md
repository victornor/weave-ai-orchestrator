## Why

On 2026-09-27 captain left the Live page and came back to a view that looked stuck. A refresh showed nothing was stuck. VS-641's heartbeat watchdog (merge `21ca880`, ancestor of the running release `1b08a734`) is live and still misses this. Queries do not refetch on window focus (`refetchOnWindowFocus: false`), so a missed stream gap is not healed by coming back to the window.

## What Changes

- Reproduce the stale Live page in a real browser against a scratch daemon before changing code. Record which of a backgrounded tab, a timer gap (sleep), and a long idle visible tab actually go stale while a refresh is correct.
- Fix the mechanism that reproduction confirms, in the shared stream layer, so every stream-backed view converges — not only Live.
- A return to a visible document, or a wake after sleep with the tab still visible, SHALL refresh the reads that stream keeps fresh within a few seconds, with no page reload.
- A reconnect SHALL refresh those reads for every workspace the document is already showing, not only workspaces that have already emitted an event. A cursor-less reconnect that starts at the tail still leaves a gap; replay alone is not enough.
- Keep VS-641's watchdog tests green, VS-227's hidden-tab behaviour (no connection while hidden), and `connectionBudget.test.tsx` (no extra connection per stream).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `live-streams/connection-state`: a stream-backed view that was left and returned converges without a reload, and a daemon-wide reconnect refreshes every workspace the document is showing, not only ones it has already seen an event for.

## Impact

- `packages/ui` stream lifecycle: `SseWatchdog` / `useLiveStream` (`sseStream.ts`), `EventStream` and `GlobalEventStream` (`events.ts`). Global Live reads `useWorkersMany` off the one daemon-wide stream (`FanInStreams`); it has no `WorkspaceProvider`, and `useConnection()` on a global page currently reports a hardcoded `connected`.
- Tests in `packages/ui` only. No live daemon, no systemd unit, no extra SSE connection per stream.
- PR description states the reproduction steps and the confirmed root cause in one paragraph, with rendered evidence of Live recovering in light and dark.
