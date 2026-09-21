## ADDED Requirements

### Requirement: The containment wrapper gets the user-bus environment; the contained command does not

When a spawn is wrapped in a `systemd-run --user --scope` containment wrapper, the spawn SHALL give the
wrapper the environment it needs to reach the user manager: `XDG_RUNTIME_DIR` and
`DBUS_SESSION_BUS_ADDRESS` when the daemon's own environment carries them. Exactly those variables
SHALL be removed from the command executed inside the scope, so a runtime whose child environment is an
explicit allowlist receives nothing beyond that allowlist — the wrapper's environment is not the
command's environment.

Where no systemd user manager is reachable, the spawn SHALL run uncontained exactly as before and SHALL
add no bus variable to the command's environment.

#### Scenario: A contained turn with a runtime dir set

- **WHEN** a turn whose child environment is an explicit allowlist is spawned with containment requested and available, and the daemon's environment carries `XDG_RUNTIME_DIR`
- **THEN** the `systemd-run` wrapper is spawned with `XDG_RUNTIME_DIR` in its environment, and the contained command is executed with `XDG_RUNTIME_DIR` and the other wrapper variables removed

#### Scenario: No runtime dir in the daemon environment

- **WHEN** containment is requested and available but the daemon environment sets neither `XDG_RUNTIME_DIR` nor `DBUS_SESSION_BUS_ADDRESS`
- **THEN** the wrapper is spawned with no bus variable and the contained command's environment is unchanged

#### Scenario: No user manager at all

- **WHEN** no systemd user manager is reachable at spawn time
- **THEN** the command runs uncontained exactly as before and no bus variable is added to its environment

### Requirement: A containment wrapper that cannot start fails in plain words

When containment is requested and reported available, but the `systemd-run` wrapper cannot reach the
user manager and exits before starting the runtime command, the turn SHALL fail with an error whose code
is `containment_unavailable` and whose message says, in plain words, that containment is unavailable.
It SHALL NOT be reported as a runtime crash carrying the wrapper's bus text, and the daemon SHALL NOT
silently re-run the command uncontained, because that would drop the memory containment the worker was
supposed to have.

#### Scenario: The wrapper cannot reach the user bus

- **WHEN** containment is requested, the availability check passes, and the wrapper exits without starting the command, writing its user-bus failure to stderr
- **THEN** the run ends with a `containment_unavailable` error of family `tooling` whose message says containment is unavailable, rather than with `agent_crashed` and the bus text

#### Scenario: A genuine runtime crash is still a runtime crash

- **WHEN** the contained command starts and later dies without a result
- **THEN** the outcome is classified as before (`agent_crashed`, or `killed` on a SIGKILL or exit 137), and not as containment-unavailable
