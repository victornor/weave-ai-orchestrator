## Context

See proposal.md — Why. Parking already exists: `parkForHuman` (`packages/core/src/runs/engine.ts`) pauses the worker, raises `retry_approval`, and offers `retry` / `retry_at_reset` or `retry_1h` / `cancel`. `parseResetTime` already feeds that choice. `applyRetryApproval` already books `retry_at_reset` from `target.resetAt`. The VS-77 card explicitly does not offer a per-worker runtime, and `tickets.assign` refuses `workerModelId` after spawn.

Two independent holes produced [VS-234](conductor://tickets/VS-234):

1. `classifyError` (`packages/runtime-sdk/src/process.ts`) matches quota text then **replaces** the message with `'provider rate limited, usage limit or quota exceeded'`. `parseResetTime` never sees the timestamp, so the card recommends `retry_1h`.
2. Even with the original text, `parseResetTime` has no `YYYY-MM-DD HH:MM:SS` form, and its clock regex `/resets?\s+(?:at\s+)?(\d{1,2})/` would take `20` from `2026-…` as hour 20.

A usage-limit card still cannot change `workerModelId`. Other catalog options are often other providers; on 2026-09-11 the deep tier was fine.

Captured provider text (no live CLI was launched; VS-129 `strings` on the installed binary, plus the VS-234 incident and recorded Claude fixtures):

**OpenCode, VS-234, 2026-09-11, live incident (standard tier):**

```
Usage limit reached for 5 hour. Your limit will reset at 2026-09-12 01:54:35
```

Workspace run history for that incident (conductor, 2026-09-11): previous opencode run finished `2026-09-11T03:36:11Z`; first opencode run of the exhausted window started `2026-09-11T12:54:13.863Z`; the `provider_quota` failure that parked the worker was at `2026-09-11T17:00:12Z`. `parseResetTime` runs at that failure, not at the window's first request. The naive clock `01:54:35` is `2026-09-11T17:54:35Z` (UTC+8), 54 minutes after the failure. Reading the same clock as UTC (`2026-09-12T01:54:35Z`) is 8 h 54 m from that `now`, which cannot be a five-hour window. The nine-hour figure on the original ticket was that UTC misread, not the wait.

**Claude CLI, `strings` on `/home/user/.local/share/mise/installs/claude/latest/claude` (not executed).** Formatter `Ou(unixSeconds)`:

- within 24 h: `toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit"?, hour12: true })` then strip the space before `am`/`pm` → `3:54pm`
- beyond 24 h: `toLocaleString("en-US", { month: "short", day: "numeric", hour, minute?, hour12, year if different })` → `Sep 12, 1:54am`
- composed as `` until your limit resets at ${Ou(...)} ``
- spend-cap with no timestamp: `You've hit your monthly spend limit`

Recorded Claude fixture `packages/runtimes/claude/fixtures/turn-simple.jsonl` (live from claude 2.1.258 on 2026-09-03): `rate_limit_event.rate_limit_info.resetsAt` is unix seconds `1788491400` (status `allowed`, not a failure). Usage-control fixture: `"resets_at":"2026-09-05T18:09:59.639941+00:00"`.

**Codex CLI, `strings` on the installed binary:** `You've hit your usage limit.` — no timestamp in the user-facing string. Structured `resets_at` exists on `UsageErrorBody` but is not known to appear in the stderr `classifyError` reads.

Existing `reset.test.ts` strings (`Try again in 2 hours`, `resets at 3pm`) stay as the relative/clock fallback. They are not the VS-234 shape.

## Goals / Non-Goals

**Goals:**
- Quota classification keeps the runtime's text so the parser and the card see the same bytes.
- `parseResetTime` is written against the captures above; absolute datetimes are tried before the clock regex; untrusted values return null.
- A quota card lists other catalog options; answering one sets `workerModelId` and resumes; worktree/branch/commits stay. Dispatcher already stale-sessions a runtime change (`dispatcher.role-pause.test.ts`).
- Create/assign/HTTP still refuse a post-spawn model change.

**Non-Goals:**
- Automatic failover, auto-answering the card, changing any other pause reason.
- A general PATCH/`ac_ticket_assign` escape hatch.
- Parsing Codex/Claude *structured* `resets_at` / `resetsAt` fields out of band. If they are not in the stored message, they are not used. A later ticket can plumb structured reset from the adapter.
- Rewriting `NAMED_CARD_OPTION_KEYS` for `retry_approval` (already a dynamic option list).
- Changing `classifyError`'s generic labels for `auth` / `transient_upstream` (out of this ticket's scope).

## Decisions

**Keep the original text on the quota branch only.**
`classifyError` today overwrites quota, transient, and auth with a canned sentence. Only the quota arm is in scope: `message` becomes `truncate(originalStderr.trim() || canned, 4000)`, family/code stay `provider_quota`. Adapters already pass `${st.errorMessage}\n${outcome.stderr}` into it, so VS-234's OpenCode `errorMessage` is in that string today and is discarded. Alternative: parse reset inside each adapter. Rejected — one parser, one stored message, the card and pause detail already share `boundedMessage`.

**Parser order, window bound, and naive clocks.**
A reset cannot be more than one full window away from *now*. `now` is the instant `parseResetTime` runs — inside `parkForHuman`, when the run fails — not the window's first request. Remaining is anywhere in `(0, W]`, not ≈ `W`: VS-234 exhausted after four hours of a five-hour window, with 54 minutes left. Fourteen days remains only as a backstop when the message names **no** window. Do not hardcode UTC+8; that zone is right for this provider and wrong for the next.

`parseResetTime(message, now)`:

1. Read a window duration `W` from the same text when present (`for N hour` on the VS-234 line). Absent `W` → bound `B = 14d`. Present `W` → bound `B = W + 2 minutes` (slack).
2. ISO-8601 **with an offset** (Claude usage-control `2026-09-05T18:09:59.639941+00:00`). Keep only if `now < t <= now + B`. Do not re-zone a timestamp that already named its offset; if it sits beyond `B`, it is unknown.
3. Naive `YYYY-MM-DD[ T]HH:MM[:SS]` (VS-234). Among whole-hour offsets −12..+14, collect each instant `t` at which that naive clock occurs with `now < t <= now + B`. If the set is empty, unknown. If several survive, take the **earliest**. Retrying too early costs one failed attempt and re-raises the card; retrying too late costs the human hours of dead time. VS-234: `now = 2026-09-11T17:00:12Z`, `W = 5h`. The UTC reading `2026-09-12T01:54:35Z` is 8 h 54 m out and is rejected. Offsets +4 through +8 all land in the next five hours; the earliest is `2026-09-11T17:54:35.000Z`. Never hardcode UTC+8.
4. Claude `Ou` beyond-24h: `Mon DD, h:mmam` / `Mon DD, YYYY, h:mmam` (`Sep 12, 1:54am`), then the same `now < t <= now + B` check.
5. Existing relative `in N hour|minute|second`.
6. Existing clock `resets at 3pm` / `15:30`, tightened so a following digit cannot be a year (`20` from `2026` must not match). Past clock-of-day still rolls to tomorrow; past **absolute** timestamps return null.

Tests copy the capture bytes. The VS-234 assertion is `now = 2026-09-11T17:00:12Z` (the actual failure instant, read off the run — not the window's first request at `12:54:13.863Z`) → `2026-09-11T17:54:35.000Z`, and the same line must **not** yield `2026-09-12T01:54:35.000Z`. A test that freezes `now` at a convenient earlier instant to make the algorithm work is not evidence.

**Switch keys are `switch:<optionId>`.**
Catalog ids are kebab-case; the prefix cannot collide with `retry` / `retry_1h` / `retry_at_reset` / `cancel`. `decisions.answer` already rejects unknown keys against the card's options. `applyRetryApproval` handles the prefix: validate against the effective catalog, write `tickets.workerModelId` through a TicketsService method that is **not** on HTTP or MCP, then `workers.resume` (parked relaunch is already resume). Option order: retry, deferred retry, other catalog options in catalog order skipping the current id, cancel last. Label: `Continue on <id>` plus the option's description when present. Recommendation never a switch.

When `workerModelId` is null, every catalog option is "other". Empty catalog → no switch buttons, same card as today plus the reset-time fix.

**Do not expose a general setter.**
`assign` / create keep throwing after spawn. The new writer is only called from `applyRetryApproval` for `switch:*` on a `provider_quota` card. Tests assert assign still refuses.

**Session vs worktree.**
Resume keeps the worktree. If the new option's runtime differs, `modelSettingFor` on the next turn plus the existing dispatcher stale-session path start a new CLI session. If the runtime is the same, resume may still attach the old session — acceptable: the human chose that option, and same-runtime quota is often account-wide anyway. Do not add a second "force new session" path in this ticket; the dispatcher already handles the runtime-change case that VS-234 needed (OpenCode → another runtime).

## Risks / Trade-offs

- **Several whole-hour offsets can land in `(now, now+W]`.** Taking the earliest can retry before the true reset: one failed attempt, the card re-raises. Taking a later offset (or the UTC misread) is the VS-234 bug this ticket exists to replace. Do not pick the candidate closest to `now+W` — remaining is not ≈ `W`, and that gate would have dropped VS-234's real reset (`|17:54:35Z − 22:00:12Z| = 4 h 05 m` at the failure instant).
- **Claude locale `Sep 12, 1:54am` depends on `en-US`.** The binary hard-codes `"en-US"`. Tests use that literal, not `toLocaleString` at runtime in the assertion.
- **A long catalog (up to 15 other options) makes a busy card.** Cap is already 16. Prefer listing them over hiding the only useful answer.
- **Same-runtime switch does not clear quota.** The card still offers it; the human owns the cost/behaviour trade. We do not filter by runtime or provider (those are not a reliable "other account" signal).
- **Structured `resetsAt` on Claude `rate_limit_event` is unused.** It is not in the stored error string today. Using it would mean adapter contract changes this ticket did not take. Mitigation: if the CLI also puts `until your limit resets at …` in `errorMessage`, the text parser covers it.

## Migration Plan

No schema change. In-flight `retry_approval` cards keep their existing options until a new quota failure supersedes them. Rollback is reverting the branch: old cards remain answerable (`retry` / `retry_1h` / `cancel`).
