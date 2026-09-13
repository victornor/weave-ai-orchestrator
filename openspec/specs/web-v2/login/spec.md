# web-v2/login Specification

## Purpose
The V2 sign-in surface: a chromeless, Mono-styled login that reuses the daemon's existing operator
authentication (password, TOTP, remembered device, first-run set-password), plus the rule that sends
an unauthenticated visitor from any `/v2` address to it and returns them to that address afterwards.

## Requirements

### Requirement: V2 has its own chromeless sign-in screen

The V2 app SHALL render its own sign-in screen at `/v2/login`, styled with the V2 (Mono) tokens in
both themes and usable at phone width, and SHALL render it without the V2 rail, header or phone tab
bar. The screen SHALL reuse the daemon's existing authentication rather than introduce a new one: the
human enters a username and password, and when the account has two-factor enabled the flow continues
to a second step collecting a six-digit TOTP code (or a recovery code) before the session is granted.
The screen SHALL offer a `remember this device` choice that names the device, and SHALL show the
daemon's existing error states — wrong credentials, the lockout countdown after repeated failures, and
an expired session — in V2's presentation. On a daemon with no operator configured it SHALL show the
existing first-run set-password step instead of asking for a password that does not exist.

#### Scenario: The screen is chromeless

- **WHEN** a user opens `/v2/login`
- **THEN** the V2 sign-in renders with no rail, header or phone tab bar around it

#### Scenario: The TOTP second step

- **WHEN** a user whose account has two-factor enabled submits a correct password
- **THEN** the flow advances to the TOTP step, and the session is granted only after a valid code

#### Scenario: A wrong password

- **WHEN** a user submits incorrect credentials
- **THEN** the V2 screen shows the typed error and the remaining attempts, not a generic failure

#### Scenario: The first-run set-password step

- **WHEN** the daemon reports no operator configured
- **THEN** `/v2/login` shows the set-password step rather than a password prompt

### Requirement: An unauthenticated `/v2` visit resolves to V2 login

Opening any `/v2` address without a session SHALL show the V2 sign-in at `/v2/login`, carrying the
address the visitor was trying to reach. The same V2 sign-in SHALL be shown when a `/v2` request is
rejected as unauthenticated after the app has loaded. This SHALL NOT change V1's behaviour: a V1
address still resolves to V1's `/login`, and V1's own `?next=` handling and redirect target SHALL stay
as they are.

A visitor SHALL be treated as unauthenticated only when the daemon **refuses** the request as
unauthenticated — an HTTP 401 or an `auth_session_expired` — and never merely because a successful
response carries no session. In particular, when `auth.loopbackTrusted` makes the daemon answer
`GET /api/me` with 200 and a `session` of `null` (a trusted local principal, `operator.id: null`), the
visitor SHALL be treated as signed in and SHALL NOT be sent to the sign-in.

#### Scenario: A deep link while signed out

- **WHEN** a signed-out visitor opens `/v2/w/<workspace>/work` directly and the daemon refuses the
  request as unauthenticated
- **THEN** the V2 sign-in renders and the attempted address is remembered for the return

#### Scenario: A session that expires under V2

- **WHEN** a `/v2` request is rejected as unauthenticated while the app is open
- **THEN** the app shows the V2 sign-in and remembers the current `/v2` address

#### Scenario: A trusted local request with no session

- **WHEN** `GET /api/me` is answered 200 with a `null` session and a `null` operator id under a
  trusted loopback daemon
- **THEN** the app treats the visitor as signed in and does not redirect to `/v2/login`

#### Scenario: V1 is not redirected to V2

- **WHEN** a signed-out visitor opens a V1 address
- **THEN** the app shows V1's own `/login` exactly as before

### Requirement: Sign-in returns to the original V2 address

After a successful sign-in from `/v2/login`, the app SHALL return the human to the `/v2` address it
remembered, and when it remembered none SHALL resolve `/v2` the way opening `/v2` does. Only a
same-version (`/v2`) path SHALL be honoured as the return target; any other value SHALL be ignored so
the sign-in cannot be used to send the session elsewhere.

#### Scenario: Returning to the attempted page

- **WHEN** a human signs in after being sent to `/v2/login` from `/v2/w/<workspace>/work`
- **THEN** the app opens that workspace's V2 Work page

#### Scenario: With nothing remembered

- **WHEN** a human opens `/v2/login` directly and signs in
- **THEN** the app resolves `/v2` the way an opening of `/v2` resolves

#### Scenario: A foreign return target is refused

- **WHEN** the return target named at `/v2/login` is not a `/v2` path
- **THEN** it is ignored and the app lands on the default resolution
