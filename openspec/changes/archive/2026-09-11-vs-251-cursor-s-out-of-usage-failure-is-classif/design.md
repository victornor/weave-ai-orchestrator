## Context

`classifyError(exitCode, stderr)` (`packages/runtime-sdk/src/process.ts`) is the single place every
runtime adapter (claude, codex, cursor, gemini, opencode) turns a failed turn's combined
`errorMessage + stderr` text into a `{ code, family, message }` triple. Everything downstream —
`run-recovery/retry-ladder`'s "never retry a usage limit" requirement, `run-recovery/stuck-worker-
parking`'s reset-time and tier-switch behaviour (VS-238) — is gated on `family === 'provider_quota'`.
The current regex is:

```
/rate.?limit|429|overloaded|quota|capacity|usage limit|limit reached|resets? (at|in) |out of credits|insufficient credit|spending cap|billing/
```

Cursor's real failure text (from the VS-250 run, quoted verbatim in the ticket) is:

```
ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.
```

Lower-cased, none of the existing alternatives match: it says "out of usage" (not "usage limit" or
"out of credits") and "increase your limit" (not "rate limit" or "limit reached"). See
`git log`-free evidence below for what was checked for the other three runtimes.

## Goals / Non-Goals

**Goals:**
- Recognise cursor's confirmed real wording as `provider_quota`.
- Recognise every other runtime's real wording that can be captured without running a live CLI
  against real credentials (forbidden by this project's rules — see "What was tried" below).
- Prove, by test, that a bare mention of "usage" (e.g. `--help` output) does not false-positive.
- Prove, by test, that the match does not depend on which non-zero exit code the process used.

**Non-Goals:**
- Changing anything about what happens once a failure is classified `provider_quota` — VS-238 owns
  that.
- A live, running-CLI capture for gemini. The project's hard rule ("never launch the real Claude
  CLI, or any other coding-CLI runtime, against live credentials from inside a ticket") applies
  equally to every runtime adapter this repo ships, gemini included — its credential is the same
  kind of shared, rotating OAuth/API-key state as Claude's.

## Decisions

**Add `out of usage` as a new alternative, not a rewrite of the existing regex.** It is a phrase
specific enough not to appear in unrelated CLI help text (unlike the rejected alternative of
matching on the bare word "usage", which the ticket explicitly forbids: "usage" appears in ordinary
`--help` banners). `increase your limit` was considered and rejected as an addition — it is generic
enough that a flag's help text ("increase the limit with --max-turns") could plausibly contain it,
and "out of usage" alone is already sufficient to match the confirmed cursor text.

**Capture method per runtime, and what each produced:**

- **cursor** — the exact text is already in the ticket, taken from a real failed run
  (VS-250, 2026-09-11). Highest-confidence capture available; used verbatim as the fixture.
- **codex** — `packages/core/src/runs/fixtures/codex-youve-hit-your-usage-limit.txt` already exists
  in this repo, committed by VS-238/VS-234 as a real capture (`"You've hit your usage limit."`). It
  is mirrored into `packages/runtime-sdk/src/fixtures/` (the same pattern VS-238 used for
  `vs-234-opencode.txt`, which already lives in both `packages/core/src/runs/fixtures/` and
  `packages/runtime-sdk/src/fixtures/`). It already matches the existing regex's `usage limit`
  alternative — no widening needed for codex, only a test proving it.
- **claude** — no live CLI run permitted. Instead: `strings` on the installed Claude Code binary
  (`/home/user/.local/share/mise/installs/claude/latest/claude`), grepped for lines containing "usage"
  or "limit" near "reached"/"exceeded"/"reset". The binary's own minified source repeatedly embeds
  the literal user-facing string `"Usage limit reached"` (e.g. as the label used when the CLI's own
  post-hoc auto-continue classifier recognises a stopped session, and elsewhere as a standalone
  string constant) — confirmed present verbatim, not reconstructed from surrounding context. That
  three-word phrase is captured as the fixture; the surrounding sentence (e.g. any reset-time
  suffix) was not found as one contiguous literal and is not claimed. It already matches the
  existing regex's `usage limit` alternative — no widening needed, only a test.
- **gemini** — no live CLI run permitted. `strings`/`rg` across the installed `@google/gemini-cli`
  bundle (`~/.local/share/mise/installs/gemini/latest`, resolves to `0.59.0`) found only *structural*
  evidence, not a literal end-user sentence: the CLI classifies Google API failures internally via
  `classifyGoogleError`, keying off HTTP-equivalent status `429`/`499`/`503`, the literal substrings
  `"capacity"` (`"exhausted your capacity"`, `"capacity exceeded"`, `"MODEL_CAPACITY_EXHAUSTED"`),
  `"quota"` (a `QuotaFailure` protobuf detail), and a `"Please retry in Xs"` pattern — into
  `TerminalQuotaError`/`RetryableQuotaError` instances. No code path was found that replaces the raw
  API message with fixed CLI copy before printing it non-interactively, so the printed text is
  expected to still carry the raw API error, which is expected to contain one of `429`, `capacity`,
  or `quota` — all three already alternatives in the existing regex. Given no literal sentence was
  found in the binary and running the CLI to observe one is against project rules, no gemini fixture
  is added; this is named in the report as required by the ticket's acceptance criterion 2, with
  what was tried.

**Exit-code path.** `classifyError` only special-cases `exitCode === 0` (returns `undefined`,
i.e. "not a failure"); every other exit code, including `null` (signal-terminated), falls through to
the same regex matching against `stderr`. So a quota message arriving with an exit code other than 1
already classifies correctly today — this is existing behaviour, not something this change adds —
and a test is added to prove it rather than leaving it asserted only by this document.

## Risks / Trade-offs

- **[Risk]** `out of usage` could theoretically match unrelated text (e.g. a sentence like "the tool
  ran out of usage — as in Skittles — well before lunch"). → **Mitigation**: this is exactly the
  class of risk the existing regex already accepts for its other phrases (`quota`, `capacity`,
  `billing`); the phrase is specific enough in practice, and the regression test for a bare "usage"
  mention guards the most likely false-positive shape (CLI help banners).
- **[Risk]** Gemini's real quota failure text remains unverified; if its actual printed message
  does not, in fact, contain `429`/`capacity`/`quota`, it will still misclassify as `unknown`. →
  **Mitigation**: named explicitly in the report per the ticket's acceptance criteria, rather than
  asserted as fixed; a future ticket with a genuine (non-live-CLI) capture route — e.g. a human
  pasting a real failure — can add the fixture and test then.

## Open Questions

(none — the only genuine unknown, gemini's exact wording, is resolved above by naming it unverified
rather than guessing a fixture from it, per this project's standing rule against hand-written
fixtures from inferred provider output.)
