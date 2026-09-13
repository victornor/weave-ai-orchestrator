## MODIFIED Requirements

### Requirement: The V2 root resolves a workspace the way V1 does

Opening `/v2` SHALL resolve within V2: the workspace this device last used when one is remembered,
with the app landing on that workspace's V2 Needs you; when none is remembered and the visitor is
signed in, the V2 onboarding address; and when the visitor is not signed in, the V2 sign-in address.
The onboarding-or-sign-in decision SHALL be the same one V1's `/` makes, but it SHALL resolve to V2's
own addresses rather than V1's `/onboarding` or `/login`. A remembered workspace the daemon no longer
reports SHALL be forgotten rather than produce an error.

#### Scenario: A returning device

- **WHEN** a device that last used workspace Acme opens `/v2`
- **THEN** the app shows Acme's V2 Needs you page and the V2 rail highlights that row

#### Scenario: No workspace remembered

- **WHEN** a signed-in device with nothing remembered opens `/v2`
- **THEN** the app opens the V2 onboarding address

#### Scenario: Not signed in

- **WHEN** a device with nothing remembered and no session opens `/v2`
- **THEN** the app opens the V2 sign-in address

#### Scenario: A forgotten workspace

- **WHEN** the remembered workspace is no longer reported by the daemon and `/v2` is opened
- **THEN** the app forgets it and resolves to the first available workspace or the V2 onboarding
  address, without an error
