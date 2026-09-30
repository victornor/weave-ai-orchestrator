# daemon-tls/tailscale-certificate Specification

## Purpose
Lets the daemon serve a publicly trusted certificate for its own tailnet name, obtained from the local
Tailscale client and renewed in place, so a browser on the tailnet trusts the daemon without a
certificate warning and the operator never handles certificate files.

## Requirements

### Requirement: A `tailscale` TLS mode serves a Tailscale-issued certificate

When `http.tls.mode` is `tailscale`, the daemon SHALL obtain a certificate and private key for its tailnet
DNS name from the local Tailscale client and serve them on the public listener. The name SHALL be
`http.tls.domains[0]` when set, and otherwise the `Self.DNSName` of the local Tailscale status, without
its trailing dot.

#### Scenario: Certificate served

- **WHEN** the daemon starts in `tailscale` mode and the local Tailscale client returns a certificate and key
- **THEN** the public listener accepts TLS connections presenting that certificate

#### Scenario: Name derived from the tailnet

- **WHEN** `http.tls.domains` is empty
- **THEN** the certificate is requested for the local Tailscale status's DNS name

#### Scenario: Name set explicitly

- **WHEN** `http.tls.domains` is non-empty
- **THEN** the certificate is requested for its first entry

### Requirement: The certificate is renewed without dropping the listener

The daemon SHALL re-check the certificate on a schedule and SHALL fetch a fresh one while the current one
has no more than a fixed renewal window of validity left. It SHALL apply the fresh certificate to the
running listener so new connections present it, without closing the listener and without interrupting
connections already open. A failed renewal SHALL be logged, SHALL leave the current certificate in
service, and SHALL be retried.

#### Scenario: Renewal swaps the certificate

- **WHEN** the certificate is within the renewal window and the Tailscale client returns a new one
- **THEN** a connection opened afterwards presents the new certificate and the same listening socket is still in use

#### Scenario: An open connection survives a renewal

- **WHEN** a live stream is open while the certificate is swapped
- **THEN** that stream continues uninterrupted

#### Scenario: A failed renewal keeps the old certificate

- **WHEN** the Tailscale client cannot be reached during a renewal
- **THEN** the daemon keeps serving the current certificate, logs the failure and tries again later

### Requirement: Start waits for Tailscale to come up

A reboot can bring the daemon's service up before tailscaled. When the local Tailscale client is
unreachable or not yet `Running`, the daemon SHALL keep retrying at a short interval for a bounded wait
of about 150 seconds, logging each wait, and SHALL start as soon as the certificate can be obtained.
Causes that waiting cannot fix (HTTPS certificates disabled, permission denied) SHALL fail at once.

#### Scenario: Tailscale comes up late

- **WHEN** the Tailscale client is unavailable for the first few attempts and then becomes available within the wait
- **THEN** the daemon starts and serves the certificate

#### Scenario: Tailscale never comes up

- **WHEN** the Tailscale client stays unavailable for the whole wait
- **THEN** startup fails with the not-running message after the wait and no listener is opened

#### Scenario: A permanent cause is not waited on

- **WHEN** the tailnet has HTTPS certificates disabled
- **THEN** startup fails immediately rather than after the wait

### Requirement: Failure is explicit and never falls back

If the certificate cannot be obtained at start, the daemon SHALL refuse to start the public listener and
SHALL report a message naming the cause and the fix. It SHALL NOT serve a self-signed certificate or plain
HTTP in its place. The causes SHALL include: the Tailscale client is not installed or its socket is
unreachable; Tailscale is installed but not running or not logged in; HTTPS certificates are not enabled
for the tailnet (naming the admin console's HTTPS Certificates setting); and the daemon's user is not
permitted to fetch certificates (naming `tailscale set --operator`).

#### Scenario: Tailscale is missing

- **WHEN** the daemon starts in `tailscale` mode and no Tailscale client socket becomes reachable within the startup wait
- **THEN** startup fails with a message saying Tailscale is not running and no listener is opened

#### Scenario: HTTPS certificates are not enabled

- **WHEN** the Tailscale client reports that the tailnet has HTTPS certificates disabled
- **THEN** startup fails with a message naming the HTTPS Certificates setting in the Tailscale admin console

#### Scenario: No silent downgrade

- **WHEN** any of the above fails
- **THEN** the daemon does not serve a self-signed certificate

### Requirement: `acme` points to the supported modes

`http.tls.mode: acme` SHALL remain unimplemented, and its error SHALL name `tailscale` and `files` as the
alternatives.

#### Scenario: acme selected

- **WHEN** the daemon starts with `http.tls.mode: acme`
- **THEN** startup fails with a message that mentions `tailscale` and `files`
