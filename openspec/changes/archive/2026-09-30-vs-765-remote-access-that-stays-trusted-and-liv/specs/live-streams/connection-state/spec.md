## ADDED Requirements

### Requirement: A stream that never opens is abandoned and retried

A live stream SHALL NOT wait indefinitely for a connection attempt to open. When an attempt has neither
opened nor failed within a fixed connect timeout, the stream SHALL abandon it, report `reconnecting`, and
retry with the same bounded backoff as a failed attempt. A retry scheduled by backoff SHALL NOT leave a
second timer running when the stream is reopened by another path (silence, wake, `online`, manual retry).

#### Scenario: A connection attempt that hangs

- **WHEN** a stream's connection attempt neither opens nor errors within the connect timeout
- **THEN** the stream closes that attempt and opens a new one

#### Scenario: Recovery re-syncs what was missed

- **WHEN** a retry after a hung or dropped connection finally opens
- **THEN** the stream resumes from its last position and refreshes the reads it keeps fresh, with no page reload

#### Scenario: Reopening cancels a pending retry

- **WHEN** a stream waiting on a backoff timer is reopened by the device coming back online
- **THEN** the pending timer is cancelled and exactly one connection results

### Requirement: Why a stream was reopened is recorded

A stream SHALL record each reopen with its cause (connection error, silence past the dead threshold,
machine wake, `online` event, connect timeout, manual retry), the time, the device's online flag and the
stream's attempt count, in a short bounded in-memory log the operator can read from the app.

#### Scenario: A silent drop is attributable

- **WHEN** a stream is reopened because nothing arrived within the dead threshold
- **THEN** the log holds an entry with cause `silence` and the age of the last frame
