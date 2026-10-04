## Why

The shared Claude login expired on 2026-09-14 (weaver and every Claude worker down ~7 h) and again on 2026-10-03 14:44Z (weaver down ~24 h, three runs failed in under a second with `errorFamily: auth`). Both times nobody told captain. VS-75 already built the runtime gate (`runs/authgate.ts`: `gateRuntimeForLogin`, one human decision card per runtime, a `notifyHuman` chat line, the dispatcher skipping gated runtimes, `supervisor.loginRecheck` probing every 60 s). The outage still went unnoticed, so the remaining gaps are:

- the fix text is `` `<runtimeId> /login` `` for every runtime, which is wrong for runtimes whose CLI logs in differently (Codex `codex login`, ...);
- the message does not say which agents are paused;
- the third consecutive auth failure on one agent takes the `parkForHuman` branch (`engine.ts` ~1294), which pauses that agent and raises a decision that owner-routes to the agent's own surface, bypassing the runtime-wide chat line — a weaver whose runtime is dead is exactly the agent that can never act on that card;
- no daemon-global incident is filed, so the Incidents page and the nightly sweep never see an outage;
- no banner shows it across the V2 shell (only the Usage page's `RuntimeCredentials` card does);
- recovery is only the 60 s probe: captain has no "I fixed it" action, and the recovery posts no "back" line.

## What Changes

- **Fix the false recovery (conductor's evidence, 2026-10-03):** the gate did fire at 14:45:00Z, but the card was withdrawn ("the login was restored") within a minute with no run having succeeded, so `supervisor.loginRecheck` released it. Its probe (`claude/src/account.ts` `probeAccount`, a `get_usage` control request) succeeds on an expired OAuth session, and the pre-check only compares `expiresAt` with the refresh-failure time. A gate now lifts only on a successful run, or when the credential has demonstrably changed since the failure (its `expiresAt` differs from the value recorded at failure) *and* the probe describes the account, or on the operator's explicit re-check. A gate that is re-raised soon after a probe release stops auto-releasing until the operator re-checks.

- Per-runtime login instructions (`claude /login`, `codex login`, `cursor-agent login`, `gemini` interactive login, `opencode auth login`) in one table in shared code, used by the chat line, the decision card and the banner.
- The outage announcement (chat line + existing push via the human-owned decision) names the runtime, the agents paused, and the exact command. Still exactly one per runtime per outage.
- The exhausted-auth `parkForHuman` branch also raises/keeps the runtime gate, so the announcement happens on every auth failure path.
- File one daemon-global incident (`reporterKind: 'system'`) on gating, deduped while open; resolve it when the runtime recovers.
- On `ungateRuntime`, post a single "back" line on the primary chat thread.
- New "I fixed it" action (`POST` recheck-now for a runtime) that runs the probe immediately instead of waiting for the 60 s tick; on failure it reports the runtime is still down.
- A V2 shell banner, on every page, while any runtime's `needsLogin` is true, with the fix text and a "Re-check now" button.

## Capabilities

### Modified Capabilities
- `runtime-credentials/login-outage`: adds requirements for runtime-specific fix text, naming paused agents, incident filing, a recovery line, an immediate re-check action, and the shell banner.

## Impact

`packages/core/src/runs/authgate.ts`, `runs/engine.ts`, `supervisor/index.ts`, `usage/accounts.ts`; `packages/shared` (fix table, route/type for recheck); `packages/server` routes; `packages/ui/src/v2/V2Shell.tsx` plus a new banner component and tests. No migration. No real CLI is ever launched; tests use fakes.
