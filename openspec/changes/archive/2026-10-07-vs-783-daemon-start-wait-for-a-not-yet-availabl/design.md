## Context

`startPublic` in `daemon.ts` calls `listen(...)`, which rejects on the server's first `error` event. `bin.ts` logs it, `startDaemon` rejects, and the failure is recorded for the next boot's notice. Only the public listener is affected; the loopback listener binds 127.0.0.1.

## Decisions

- **Retry inside `listen`, around `server.listen`.** On an error whose `code === 'EADDRNOTAVAIL'`, wait and call `server.listen` again on the same server object (Node allows re-listening after a failed listen). Any other code rejects immediately. Fewer moving parts than creating a new server per attempt.
- **Bound and backoff:** 60 s total, delay starting at 500 ms, doubling, capped at 5 s. On expiry reject with the last `EADDRNOTAVAIL` error unchanged, so message and logs match today.
- **One info line** at the first failed attempt: `waiting for listen address <host> to become available` (with the bound), none per retry.
- **Failure record only on final failure:** the retry is entirely inside `startPublic`, before the failure path, so a successful wait leaves no failed-start record.
- **Test seams:** `StartOptions.listenWait?: { timeoutMs; initialDelayMs; maxDelayMs }` for short bounds, and a pure exported `listenWithWait(bind, opts)` taking a bind function so delayed-availability is tested with a stub instead of needing a real interface IP. The never-available daemon-level test uses an unassigned TEST-NET address (192.0.2.1) with a short bound; `EADDRINUSE` uses an ephemeral port already held by the test.
- Alternatives rejected: changing the systemd unit (out of scope, per ticket); binding `0.0.0.0` (changes exposure).

## Risks

A mistyped address now delays failure by up to 60 s instead of failing at once; the info line names the address so it is visible.
