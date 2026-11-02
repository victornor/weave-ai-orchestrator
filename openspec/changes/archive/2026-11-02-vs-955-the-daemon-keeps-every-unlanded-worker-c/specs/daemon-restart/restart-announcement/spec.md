## MODIFIED Requirements

### Requirement: The daemon records a durable lifecycle across restarts

The daemon SHALL record, in its own database, when it last booted and which release it booted on; when it begins a shutdown, SHALL record that the shutdown is deliberate and why; and when a start attempt fails, SHALL record that it failed with the reason. These records SHALL survive the restart and SHALL be the only source for deciding whether the previous process shut down cleanly.

While it is serving, the daemon SHALL also record a liveness instant at least once a minute, and when it runs under a service manager that gives it an invocation identifier it SHALL record that identifier with its boot, so that a later boot can bound or look up how the process ended even when it recorded no shutdown.

A shutdown, a reason or a liveness instant recorded before the previous boot SHALL NOT be attributed to the previous process: it belongs to an earlier one.

#### Scenario: A clean restart

- **WHEN** a daemon that recorded a boot then records a shutdown starts again
- **THEN** the new boot can tell the previous process shut down cleanly

#### Scenario: A crash

- **WHEN** a daemon starts and the previous process recorded a boot but no shutdown after it
- **THEN** the new boot can tell the previous process did not shut down cleanly

#### Scenario: A failed start attempt

- **WHEN** a start attempt fails and a later attempt succeeds
- **THEN** the successful boot reports the failed attempt and its reason

#### Scenario: The very first boot

- **WHEN** a daemon starts with no lifecycle record at all
- **THEN** it records a boot and reports no restart

#### Scenario: A stale shutdown from an earlier process is not reused

- **WHEN** the lifecycle holds a shutdown at 02:10:34.237 with reason `SIGTERM`, the previous boot was at 02:10:34.638, and the previous process then crashed without recording a shutdown
- **THEN** the new boot reports the previous process as not clean, with no down time and no shutdown reason taken from the 02:10:34.237 record

#### Scenario: The serving process leaves a liveness trail

- **WHEN** the daemon has been serving for more than a minute
- **THEN** its lifecycle record holds a liveness instant no older than a minute

### Requirement: The weaver's instructions say what to do with a restart wake

The weaver's always-loaded instructions and skill SHALL describe the restart wake — source `system`, payload `kind: daemon.restarted` — and SHALL say to relay one short paragraph to the human from it (when it went down and came back, clean or crash, the turns that were interrupted and are resuming, and any failed start) and then carry on, adding to the chat's "back up" line rather than repeating it. They SHALL say that a null `downAt` means the down time is unknown, that `lastAliveAt` is only an upper bound, and that the weaver must not compute or state an outage length the payload does not carry.

#### Scenario: The instructions name the wake

- **WHEN** the weaver's instructions are rendered
- **THEN** they describe the `daemon.restarted` wake and how to handle it

#### Scenario: The instructions forbid inventing an outage length

- **WHEN** the weaver's instructions are rendered
- **THEN** they say that a null `downAt` is reported as an unknown down time, never as a number

## ADDED Requirements

### Requirement: A restart states the outage only as far as it is known

The restart wake and the chat line SHALL report the time the daemon went down, and how long it was down, only when that time is known: from the previous process's own recorded deliberate shutdown, or from the service manager's record of that process's exit. When neither exists, the down time SHALL be reported as unknown — `downAt` null — and SHALL NOT be filled from any other record. The wake SHALL then carry the previous process's last recorded liveness instant, when there is one, as an upper bound on the outage, labelled as a bound and not as the down time. `clean: false` with no known down time SHALL be what drives an "unknown" report.

Where the service manager recorded how the previous process exited, the wake SHALL carry it — the exit kind (exited, killed, dumped), the status or signal, the unit result and the restart counter — and the chat line SHALL name the signal or exit status. A shutdown reason recorded by an earlier process SHALL NOT be reported for a crash. When the exit cannot be determined, the wake SHALL say the reason is unknown rather than guess one.

Looking up the service manager's record SHALL be bounded in time and SHALL NOT delay or fail the boot; when the lookup is unavailable or fails, the report falls back to unknown.

#### Scenario: A crash with no recorded shutdown and no service-manager record

- **WHEN** the previous process booted at 02:10:34.638, crashed without recording a shutdown, the lifecycle still holds a shutdown at 02:10:34.237 from the process before it, and no service-manager record is available
- **THEN** the wake has `clean: false`, `downAt: null` and no shutdown reason, the chat line says the down time is unknown, and no reported time predates the previous boot

#### Scenario: A crash bounded by the last liveness instant

- **WHEN** the previous process crashed without recording a shutdown, its last liveness instant is 19:59:50 and this boot is at 20:00:46
- **THEN** the wake carries `lastAliveAt` 19:59:50 as an upper bound on the outage and `downAt` stays null

#### Scenario: A crash the service manager recorded

- **WHEN** the previous process ran under systemd with a recorded invocation identifier, and the journal for that invocation records `Main process exited` with code `dumped` and status `7`, a unit result `core-dump` and a restart counter of 1
- **THEN** the wake carries `downAt` set to the time of that exit, the exit kind `dumped`, signal `SIGBUS`, unit result `core-dump` and restart counter 1, and the chat line names `SIGBUS` and the down time of about 3 seconds

#### Scenario: The service-manager lookup is unavailable

- **WHEN** the previous process crashed and the journal lookup is unavailable, times out or returns nothing for its invocation
- **THEN** the boot proceeds without delay and the wake reports the exit reason as unknown

#### Scenario: A clean restart keeps its recorded time and reason

- **WHEN** the previous process recorded a deliberate shutdown after its own boot
- **THEN** the wake carries that shutdown's time as `downAt` and its reason, exactly as before
