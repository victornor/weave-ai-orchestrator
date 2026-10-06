## Purpose
Lets the daemon start cleanly when its configured listen address is an interface IP that is assigned after the daemon launches, such as a Tailscale address at boot, instead of exiting and relying on the service manager to restart it.

## ADDED Requirements

### Requirement: Start waits a bounded time for a not-yet-available listen address

When binding the public listener fails with `EADDRNOTAVAIL`, the daemon SHALL retry the bind with a backoff for at most 60 seconds, logging one info line that names the address. Any other bind error SHALL fail the start immediately. When the bound passes without the address becoming available, the start SHALL fail with the `EADDRNOTAVAIL` error as it does without the wait.

#### Scenario: Address becomes available after a delay

- **WHEN** the first bind attempts fail with `EADDRNOTAVAIL` and a later one succeeds within the bound
- **THEN** the daemon starts once, logs one waiting line, and records no failed start

#### Scenario: Address never becomes available

- **WHEN** every attempt fails with `EADDRNOTAVAIL` until the bound passes
- **THEN** the start fails with the `EADDRNOTAVAIL` error and a failed start is recorded

#### Scenario: Address in use fails fast

- **WHEN** the bind fails with `EADDRINUSE`, or any error other than `EADDRNOTAVAIL`
- **THEN** the start fails immediately without retrying
