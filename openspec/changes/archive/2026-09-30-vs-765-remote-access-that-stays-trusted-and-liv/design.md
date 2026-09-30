## Context

### TLS

`tlsOptions` (`packages/server/src/daemon.ts:564`) returns `{cert, key}` once, and `listen` (`:546`) passes
them to `createServer` as `serverOptions`. `self-signed` generates a 10-year certificate once and reuses it.
Nothing is ever re-read. `acme` is in the enum (`packages/shared/src/config.ts:761`) and throws.

Checked on this host (Tailscale 1.102.4, user `v`, no sudo):

- `tailscale status --json` gives `BackendState: Running`, `Self.DNSName: myhost.tailnet-name.ts.net.` and
  `CertDomains: [myhost.tailnet-name.ts.net]`.
- `tailscale cert` as an unprivileged user wrote a Let's Encrypt certificate (issuer `C=US, O=Let's Encrypt,
  CN=YE1`, 90 days).
- The same certificate comes from the LocalAPI: `GET /localapi/v0/cert/<name>?type=pair` over
  `/var/run/tailscale/tailscaled.sock` returned 200 with one PEM holding the private key first, then the
  certificate chain. `tailscaled.sock` is mode `srw-rw-rw-`, but cert issuance is still gated by the
  caller being root or the configured operator, which is what the error message has to name.

The Settings UI has no TLS control. `tlsMode` is only read from `/health` (`routes/daemon.ts:59`). TLS is
configured in `daemon.yaml` and needs a restart to change, so the "selectable in Settings" line of the
ticket resolves to: selectable in `daemon.yaml` and documented, with no new Settings surface.

### Live stream, what is known

The client already has most of what the ticket asks for, from VS-100, VS-227, VS-641 and VS-706:

- server heartbeat, a named `heartbeat` event every 15s (`packages/server/src/sse.ts:59`), bounded writes
  (`WRITE_TIMEOUT_MS`);
- `SseWatchdog` (`packages/ui/src/api/sseStream.ts`): stale at 30s, dead at 37.5s, wake detection;
- reconnect with backoff `[0.5s .. 15s]`, `online` handling, `?after=<seq>` resume and `resync()` on reconnect;
- `ConnectionBanner` showing `Reconnecting…`, `No updates since …`, `Offline …`.

So "add a heartbeat and watchdog and a reconnecting state" is already true and is not redone. What the ticket
cannot be answered with is a single proven cause, and this proposal does not claim one. What the code does
show:

1. **A connection attempt that never opens is never timed out.** The watchdog is only started in
   `onopen` (`sseStream.ts:203`, `events.ts:198`, `events.ts:370`). Until then the only recovery is the
   browser firing `onerror`. A SYN into a dead path after a Tailscale or network change, or a request stuck
   behind the six-connection HTTP/1.1 limit per origin (several tabs each hold a workspace stream, a global
   stream and run streams; the daemon's `https.createServer` speaks HTTP/1.1 only), stays `connecting` with
   no `onerror` for as long as the browser waits, typically minutes. `onDead` and `onWake` both call
   `open()`, so they walk straight into it: the stream is marked `reconnecting` and then sits in an attempt
   nothing supervises. This is reproducible with an `EventSource` double that never fires.
2. **`EventStream.open()` does not clear a pending backoff timer** (`events.ts:188`; the global stream does at
   `:363`). An `online`, wake or manual reopen while a backoff timer is pending leaves the timer, which
   later calls `open()` again and replaces the healthy connection. Harmless once, but it makes the reconnect
   sequence non-deterministic.
3. **`onerror` cannot say why.** `EventSource` exposes no status or TLS detail. A lapsed certificate
   exception, a 401 after the session expires, and a dead network all look identical and all retry forever.
   With `self-signed`, a bypass that Chrome no longer honours makes every new connection fail for the
   certificate while a stream that was already open keeps working until it drops, which fits "updates stop,
   reload shows the certificate page". That is a hypothesis, not a finding. Removing the untrusted
   certificate removes the hypothesis, and the diagnostic log is how the remaining causes get identified
   from captain's own browser rather than guessed at.

## Decisions

### D1: fetch the certificate over the LocalAPI, not the `tailscale` binary

A new `packages/server/src/tailscaleCert.ts` talks HTTP over the unix socket with `node:http`
(`socketPath`). It needs no `tailscale` binary on `PATH` (a systemd unit may not have it), returns the
typed JSON errors the CLI would have to be scraped for, and is testable against a stub HTTP server on a
temporary socket. The status read is `GET /localapi/v0/status` (same JSON as `tailscale status --json`).
Socket path: `AC_TAILSCALE_SOCKET`, else `/var/run/tailscale/tailscaled.sock`. A `TailscaleClient`
interface (`status()`, `cert(name)`) is the seam tests stub, so the daemon tests need no socket.

### D2: hot-swap with `setSecureContext`

`listen` keeps its server and returns a handle. On renewal the daemon calls `server.setSecureContext({cert,
key})` on the `https.Server`. Node applies it to new handshakes and leaves established connections alone.
The listener is never closed. The hono adaptor's server is a real `https.Server`, so no wrapper is needed.
Reads: the swap is tested by connecting with `node:tls`, reading `getPeerCertificate().fingerprint256`
before and after, and asserting the listening socket's `address()` and an open SSE connection are
unchanged.

### D3: renewal schedule

Check every 12 hours and renew when `notAfter` is 30 days or less away (Tailscale certificates are 90 days
and tailscaled renews its own copy lazily on request, so asking again returns the cached one until it is
near expiry). Read `notAfter` with `X509Certificate`. A failed renewal is logged at `warn` and retried at
the next tick, and once under a day remains, every hour. The timer is `unref`'d and cleared on shutdown.

### D4: failure messages

Mapped from the LocalAPI response and socket errors, each a single sentence with the fix:

- `ENOENT`/`ECONNREFUSED` on the socket: "Tailscale is not running (no socket at <path>). Start tailscaled, or set http.tls.mode to files."
- `BackendState` not `Running`: "Tailscale is <state>. Run `tailscale up`."
- no `CertDomains`, or the cert endpoint reporting HTTPS disabled: "HTTPS certificates are not enabled for this tailnet. Enable HTTPS Certificates in the Tailscale admin console (DNS page)."
- 403: "This user may not fetch certificates from tailscaled. Run `sudo tailscale set --operator=$USER`."

Start fails. There is no fallback. The wording of the real error bodies is captured from a scratch
daemon against the host's tailscaled before the matchers are written (per the conductor's rule on
matching program output); the 403 and HTTPS-disabled bodies cannot be produced here and are unverified.

### D5: client connect watchdog, shared

`SseWatchdog` gains an `armConnect()` and the class also owns the timer, so all three stream
implementations (`useLiveStream`, `EventStream`, `GlobalEventStream`) get it from one place rather than
three copies. Connect timeout 20s (longer than a healthy TLS handshake over DERP, shorter than the
browser's own minutes). On expiry: close the attempt, report `reconnecting`, back off like an error.
`open()` in all three clears any pending backoff timer first.

### D6: reconnect log

A module-level ring (last 50 entries) in `sseStream.ts`, written by every reopen path with
`{at, stream, cause, online, attempts, lastFrameAgeMs}`. After a reconnect-worthy error the client does one
`fetch('/health')` with a 5s timeout and records `ok` or the failure class (`TypeError` is network or
certificate, an HTTP status is named). The banner gets a "details" toggle listing the last entries.

## Risks / Trade-offs

- A cert swap affects new connections only; an existing browser keeps its old connection and certificate.
  That is correct.
- `tailscale` mode binds nothing new: it serves on the existing `http.listen` port. Captain still has to
  change `daemon.yaml` and restart once.
- The real trust check (a browser accepting the certificate) cannot be done from a ticket. The
  `openssl s_client` issuer check against a scratch daemon can, and is the acceptance evidence.
- Without captain's browser the live-update cause stays a hypothesis. The change fixes the two defects
  it can reproduce (1, 2), removes the certificate hypothesis, and adds the capture.

## Addendum: start waits for Tailscale (approval note)

After a reboot the daemon's user unit can come up before tailscaled. `resolveTailscaleCert` retries an
unreachable socket or a `BackendState` other than `Running` every 5 seconds for up to 150 seconds, logging
each wait at `info`, and only then fails with the D4 message. HTTPS-disabled and 403 fail at once because
waiting cannot fix them. Tests inject a stub client and a short wait through a `StartOptions.tailscale` seam.
