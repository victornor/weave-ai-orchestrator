## Why

When the configured listen address is an interface IP that appears after the daemon starts (Tailscale's `100.x` address at boot), the bind fails with `EADDRNOTAVAIL`, the daemon logs `daemon failed to start` and exits 1, and only systemd's `Restart=` brings it back. Each time, the restart notice then reports "1 start attempt failed", which reads as a fault when nothing was wrong. It happened on 2026-10-04 and 2026-10-06.

## What Changes

- At startup, an `EADDRNOTAVAIL` on the public listen address is retried with a short backoff for a bounded time (default 60 s), logging one info line (`waiting for listen address X to become available`).
- If the address appears in time the daemon starts once, with no failed-start record. If the bound passes, the start fails with the same error as today.
- Every other listen error (`EADDRINUSE`, `EACCES`, ...) still fails immediately.
- Generic for any address; no change to any systemd unit or host.

## Capabilities

### New Capabilities
- `daemon-listen-wait`: the daemon waits a bounded time for a not-yet-assigned listen address instead of failing the start.

### Modified Capabilities

## Impact

- `packages/server/src/daemon.ts` (`listen`, `StartOptions`); tests in `packages/server/test/`.
- No API, config-file or CLI change.
