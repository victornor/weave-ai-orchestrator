## Why

Captain reaches the daemon over Tailscale at `https://myhost.tailnet-name.ts.net:7433`. Two things go wrong
together: the live stream silently stops delivering updates, and a reload then lands on Chrome's
`ERR_CERT_AUTHORITY_INVALID` page because `http.tls.mode: self-signed` serves a certificate no browser
will ever trust (a "proceed anyway" bypass is temporary, so the warning comes back). The daemon itself is
not restarting (`NRestarts=0`). Tailscale can issue a publicly trusted Let's Encrypt certificate for this
exact name, and the daemon should use it. The live stream, meanwhile, has a real gap in how it handles a
connection that never opens.

## What Changes

- New TLS mode `tailscale`: the daemon fetches a trusted certificate for its tailnet name from the local
  tailscaled (LocalAPI over the unix socket), serves it, and renews it before expiry by swapping the
  certificate into the running listener, with no restart and no dropped connections.
- The name is derived from `tailscale status --json` (`Self.DNSName`) unless `http.tls.domains` is set.
- It fails at start with a message naming the fix (Tailscale not running, HTTPS certificates not enabled
  on the tailnet, the user not permitted to fetch certificates) and never falls back to self-signed.
- `acme` stays unimplemented, and its error now points to `tailscale` or `files`.
- The web client's live streams get a connect watchdog: a stream that has not opened within a bounded time
  is abandoned and retried, instead of waiting indefinitely for an `onerror` that may never come. A
  pending backoff timer can no longer double-open a stream.
- A small diagnostic log of why each stream was reopened (error, silence, wake, online, connect timeout),
  with the device's online flag and a `/health` probe result, so the next occurrence on captain's device
  is identified from recorded data rather than argued about.
- The `Reconnecting…` banner, heartbeat, watchdog, resync and backoff already exist (VS-100, VS-641,
  VS-706). This change keeps them and adds tests for them as acceptance criteria. It does not rebuild them.
- Docs: `docs/OPERATIONS.md` and `README.md` describe the new mode and the one-time Tailscale setup.

Out of scope: `acme`; a Settings UI for TLS (no Settings surface configures TLS today, it is
`daemon.yaml` only, and a mode change needs a restart); switching this host's live config (captain does
that after it ships); HTTP/2.

## Capabilities

### New Capabilities

- `daemon-tls/tailscale-certificate`: obtaining, serving and renewing a Tailscale-issued certificate.

### Modified Capabilities

- `live-streams/connection-state`: a stream that never opens is timed out and retried; reconnect causes
  are recorded.

## Impact

- `packages/shared/src/config.ts` (tls mode enum), `packages/server/src/daemon.ts` (`tlsOptions`, `listen`),
  a new `packages/server/src/tailscaleCert.ts`.
- `packages/ui/src/api/sseStream.ts`, `events.ts` (workspace and global streams), `runStream.ts`.
- `docs/OPERATIONS.md`, `README.md`. No database or API change.
