## 0. False recovery
- [x] 0.1 Record the credential's `expiresAt` at failure; `loginRecheck` releases only when it has changed and the probe describes the account
- [x] 0.2 Re-gate within 15 min of a probe release suspends auto-recheck for that runtime until the operator re-checks (or a run succeeds)
- [x] 0.3 Tests: probe that describes the account while `expiresAt` is unchanged does NOT release

## 1. Fix text
- [x] 1.1 Add `RUNTIME_LOGIN_COMMANDS` (+ fallback) to `packages/shared`; use it in authgate text and `RuntimeCredentials`

## 2. Daemon
- [x] 2.1 Announcement text names paused agents and the runtime's command
- [x] 2.2 (dropped, see design 3: the gate did fire; the exhausted path is per-agent by design)
- [x] 2.3 File and resolve one daemon-global incident per outage
- [x] 2.4 Post a single recovery line from `ungateRuntime`
- [x] 2.5 `recheckLogin` core method and operator route
- [x] 2.6 Tests: one line + one push + one incident per outage, later runs held, probe resumes and posts recovery, non-auth failure does nothing (fake CLI/stubs only)

## 3. UI
- [x] 3.1 `LoginBanner` in `V2Shell` with re-check button
- [ ] 3.2 UI tests; light and dark captures attached to the ticket

## 4. Verify
- [ ] 4.1 lint, typecheck, both suites with counts pasted
