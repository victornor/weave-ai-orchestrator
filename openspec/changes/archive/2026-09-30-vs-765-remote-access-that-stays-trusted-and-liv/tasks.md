## 1. Tailscale client

- [x] 1.1 Add `tailscale` to the tls mode enum in `packages/shared/src/config.ts`; keep `acme`, change its error in `tlsOptions` to name `tailscale` and `files`
- [x] 1.2 `packages/server/src/tailscaleCert.ts`: `TailscaleClient` (`status()`, `cert(name)`) over the LocalAPI unix socket, PEM-pair parsing, and the D4 error mapping; capture the real response bodies from the host's tailscaled first and build the matchers and fixtures from them
- [x] 1.3 Tests against a stub LocalAPI server on a temporary socket: cert loaded and parsed, name derived from `Self.DNSName`, `domains[0]` overrides, each D4 failure gives its message

## 2. Serving and renewing

- [x] 2.1 `tlsOptions`/`listen` in `daemon.ts`: the `tailscale` mode obtains the certificate, waits up to ~150s (logged) for an unreachable or not-Running Tailscale before failing with the D4 message, never falls back, and `listen` returns a handle that can swap the secure context
- [x] 2.2 Renewal loop (12h check, 30-day window, hourly retry under a day, unref'd, cleared on shutdown), applying the new certificate with `setSecureContext`
- [x] 2.3 Tests: served certificate fingerprint matches the stub's; after a forced renewal a new connection sees the new fingerprint, `address()` is unchanged and an open SSE connection survives; a failed renewal keeps the old certificate; a client that becomes available after a few attempts lets the daemon start, one that never does fails after the bound with no listener, and a permanent cause (HTTPS disabled) fails immediately

## 3. Live streams

- [x] 3.1 Failing reproductions first: an `EventSource` double that never opens leaves `useLiveStream`, `EventStream` and `GlobalEventStream` stuck `connecting`; a reopen during a pending backoff timer double-opens `EventStream`
- [x] 3.2 Shared connect timeout in `SseWatchdog`, wired into the three stream implementations; `open()` clears the pending backoff timer everywhere
- [x] 3.3 Reconnect log ring with causes and the `/health` probe, and the banner details toggle; the shell now renders `ConnectionBanner` for the daemon-wide stream on every page (it was rendered nowhere in V2)
- [x] 3.4 Tests: hung connect is abandoned and retried; drop then reconnect resumes from the last seq and calls resync; heartbeats alone keep an idle stream `connected` past the dead threshold; pending timer cancelled on `online`; log entries carry cause and last-frame age

## 4. Docs and verification

- [x] 4.1 `docs/OPERATIONS.md` TLS table and a Tailscale setup section (HTTPS certificates on, operator permission, `daemon.yaml` snippet); `README.md` Quickstart B uses `tailscale`; the `acme` row points to `tailscale` and `files`
- [x] 4.2 Real check from a scratch daemon (own `--config-dir`, non-7433 port, recorded PID): `openssl s_client` reports the Let's Encrypt issuer; state plainly anything that could not be run
- [x] 4.3 Lint, typecheck, and both test suites green, both blocks pasted verbatim
