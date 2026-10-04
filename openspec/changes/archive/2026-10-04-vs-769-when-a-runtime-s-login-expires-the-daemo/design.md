## Context

Detection is `runs/engine.ts` finalize: `errorFamily === 'auth'` (set at ~1116–1126 from the adapter's `failure.family`). It calls `gateRuntimeForLogin` (authgate.ts) except when `authFailuresExhausted` (3 failed-auth runs in a row on one agent), which calls `parkForHuman`. The human decision is `owner: 'human'`, so `PushDispatcher` (`server/src/pushDispatcher.ts`, on `decision.created`) already sends one push per card; the card has a per-runtime correlation key, so push and chat are already once per outage. Hold = `dispatcher` skips gated runtimes; resume = `supervisor.loginRecheck` every 60 s -> `ungateRuntime`.

## Decisions

1. **Reuse, don't rebuild.** Extend authgate rather than adding a parallel mechanism; the ticket's items 1–3 are largely satisfied, and the work is making them correct and complete (tests assert it).
2. **Fix text table** `RUNTIME_LOGIN_COMMANDS` in `packages/shared`, keyed by runtime id with a generic fallback, so core and UI share it. Commands are taken from each runtime package's own docs/adapter, not guessed; any I cannot confirm from the repo are marked in the PR as unverified.
3. **Exhausted path left alone** (revised after evidence): the live DB showed the gate did fire on 2026-10-03; the cause of the silence was the probe releasing it. The VS-137 parking path stays a per-agent matter.
3b. **Probe cannot lift a gate alone**: `recheckRuntimeLogin` requires the credential expiry to differ from the one recorded at failure (`meta` key `login:failed_expiry:<rt>`), and after a probe release that fails again within 15 min only a successful run or the operator's re-check lifts it (`login:manual_only:<rt>`).
4. **Incident**: `services.incidents.create({reporterKind:'system', ...})` (same pattern as the VS-579 memory incident), deduped by open incident with the title prefix; resolved on recovery. Skipped silently if the service is absent.
5. **Recovery line**: `ungateRuntime` returns released count; post "back" via `notifyHuman` only if it actually cleared a gate.
6. **Re-check action**: a core `accounts`/supervisor method `recheckRuntimeLogin` shared by `loginRecheck` and `POST /usage/accounts/login-recheck`. Operator-only.
7. **Banner**: `LoginBanner` in `V2Shell` next to `ShellConnectionBanner`, fed by the existing `usageCredentials` query (polled, plus refreshed on the event stream if a credential event exists).

## Risks

- The 10-03 cause of silence is not proven; exhausted-path routing is the leading hypothesis from code reading. Tests cover that path, but I cannot reproduce it live (no real CLI).
