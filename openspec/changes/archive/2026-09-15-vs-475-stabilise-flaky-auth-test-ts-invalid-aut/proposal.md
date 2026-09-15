# Stabilise the flaky `auth.test.ts` TOTP window check

Tracker change for [VS-475](weave://tickets/VS-475). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

VS-457's first full core run after rebasing failed one test, `packages/core/src/auth/auth.test.ts`
"requires and verifies a TOTP code once enabled, and accepts a recovery code once", with
`auth_totp_invalid` / `invalid authentication code` (the message from `AuthService.login`). It
passed in isolation and on a re-run. Landing checks run the full suite behind one serial merge
slot, so a flake here can fail an approved PR and stall the queue.

## What was found

The test generates a TOTP code with `authenticator.generate(secret)` (otplib) and the product
verifies it with `authenticator.check(...)` inside `login`. otplib's default `window` is `0`
(no past/future step tolerance; `@otplib/core` `totpDefaultOptions`/`authenticatorDefaultOptions`)
and its `epoch` defaults to `Date.now()` read at each call. So if `generate` runs in the last
milliseconds of a 30-second step and the verifier reads the clock after the step rolls over, the
code is rejected. The gap between them is the real work in `login`: an argon2id password verify
(`argonVerify`) runs before the TOTP check, and under CPU load that gap grows.

Reproduced deterministically through the real service path (temporary harness, since removed):
spin to generate 5 ms before a boundary, then `login` — `generatedAt=29995ms checkedAt=3ms
outcome="auth_totp_invalid"`. The same flow mid-step returns a token. A direct otplib probe
confirmed the mechanism: code generated at `msIntoWindow=29991`, checked 60 ms later, `check` false.
This is a test-clock artefact, not a product race.

## What changes

- **Pin the TOTP clock in the test.** `packages/core/src/auth/auth.test.ts`'s TOTP test installs
  vitest fake timers for `Date` only (`vi.useFakeTimers({ toFake: ['Date'] })`) and sets the system
  time to a fixed mid-step instant, so `generate()` and the verifier's `check()` always read the
  same `now` and the same 30-second window. `afterEach` restores real timers. Test-only; no product
  code changes, and otplib's accepted window is not widened.
- **Check the product.** The otplib `window: 0` default is noted in the delivery as a product
  robustness observation (no ±1-step tolerance for a real authenticator app crossing a step), but
  no local spec requires tolerance and the ticket forbids changing auth behaviour to pass the test,
  so it is not changed here.

## Out of scope

- Any change to `AuthService`, otplib options, or the accepted TOTP window.
- The other landing-check flakes tracked separately (VS-438, VS-446, VS-453).
