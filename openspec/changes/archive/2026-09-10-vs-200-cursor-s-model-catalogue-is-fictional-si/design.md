## Context

See `proposal.md` for motivation. VS-155 (the original Cursor adapter build) explicitly declined a
dynamic `--list-models` call as a non-goal, because the role investigating it could not spawn the
real CLI to learn the flag existed or what it returns — it fell back to a hand-typed list "revisit
later the way VS-129 did for Claude" (`openspec/changes/archive/2026-09-09-vs-155-.../design.md`).
The owner's 2026-09-10 comment on this ticket lifts that constraint for the *shipped adapter*
(not for this worker's own verification, where the credentials rule is unchanged): `cursor-agent
--help` documents `--list-models` ("List available models and exit") as a real flag, so the
adapter itself may call it — this worker still may not.

Two adapters already establish the two relevant precedents in this repo:
- `packages/runtimes/opencode/src/adapter.ts` already spawns its CLI (`opencode models`) inside
  `listModels()`, parses the output, tags results `source: 'detected'`, and falls back to a static
  list on any failure — with **no caching at all**. Its own tests invoke the real `opencode`
  binary, because `opencode models` lists locally configured providers and needs no live account.
- `packages/core/src/usage/accounts.ts` + migration `0008_runtime_accounts.sql` is the repo's
  established pattern for a per-`(workspace, runtime)` CLI-probe result that *does* need caching
  and graceful degradation: a DB-backed snapshot, refreshed by the supervisor poll, a manual
  on-demand sync with a per-runtime throttle (`MANUAL_SYNC_INTERVAL_MS`), and — critically — a
  failed probe leaves the previous snapshot standing rather than blanking it.

Cursor's `--list-models` sits between these two: unlike `opencode models`, the owner expects it to
be account/plan-gated (so it is a real, if cheap, network call, not a free local listing), which is
why caching matters here in a way it did not for opencode.

`RuntimeAdapter.listModels()` takes no arguments today (`packages/runtime-sdk/src/index.ts:95`) —
unlike `describeAccount`/`readCredential`, it is never given a `configHome`. The only production
caller, `GET /runtimes/:id/models` (`packages/server/src/routes/daemon.ts:105-109`), is a global,
workspace-agnostic daemon route with no per-workspace credential threaded through it.

## Goals / Non-Goals

**Goals:**
- Every id `listModels()` returns is real, from either the dynamic or the fallback path.
- The CLI is not spawned on every call to `listModels()`.
- A human always sees a usable, correctly-labelled list, even with the binary missing, the call
  failing, or the account not logged in.

**Non-Goals:**
- A DB-backed, per-workspace snapshot like `runtime_accounts`. Rejected for this ticket (see
  Decisions) in favor of an in-process cache; revisit only if a real need for per-workspace
  differentiation in the returned catalogue shows up in practice.
- Changing the `RuntimeAdapter.listModels()` signature, the daemon route, or any UI call site.
  `RuntimeModel[]` is unchanged in shape; every existing caller keeps working untouched.
- Offering parameterized model variants (e.g. `claude-opus-4-8[context=1m,effort=high,fast=false]`)
  that this adapter itself constructs. Only ids `--list-models` itself emits are offered.
- Merging rejection-message ids (the "Cannot use this model" parse) into the cache. That parse
  only enriches the error message a human sees on an already-failed turn.

## Decisions

### In-process TTL cache, not a DB-backed per-workspace snapshot

`listModels()` caches its last successful result in a module-level variable with an expiry
timestamp (proposed: 15 minutes), the same shape as a simple memoize. Rejected the
`runtime_accounts`-style DB table because:
- It would require a migration, a new core service, and (since credentials are per-workspace via
  `ctx.paths.runtimesHome`) either a new workspace-scoped route or a signature change to
  `listModels()` to accept `configHome` — none of which any other part of this ticket needs, and
  all of which the existing global route and every UI call site would otherwise have to grow to use.
- The catalogue is not billing-critical state worth surviving a daemon restart the way an account
  snapshot is; re-populating it costs one CLI call.
- Today's route already has no workspace concept for models, and opencode's equivalent has *no*
  cache at all and is accepted — an in-process TTL is already stricter than the status quo.

Consequence: the enumeration reflects whichever Cursor login `cursor-agent`'s own default
resolution finds in the daemon process's environment (typically the host's shared, real login on
an ordinary single-user daemon — the common case, and the one the owner's own repro hit). An
isolated/dev daemon with no shared credential (VS-143) simply always falls back to the static
list, which is the safe, expected behavior for a config-dir with no login in it.

### `cursor-agent --list-models` output format, verified by static analysis

The installed `cursor-agent` 2026.09.08-6caf4ff bundle was read directly (`strings`/`grep`/`dd` over
`index.js` and its lazy chunk `5727.index.js`, the same spawn-free method VS-99/VS-129 used) —
never executed. `--list-models` dispatches to `handleModelsList` in `./src/commands/models.ts`,
which authenticates (via an existing login/API key/auth token — it errors "Authentication
required" rather than proceeding unauthenticated, and prompts an interactive login only when no
credential exists at all), fetches `availableModels`/`defaultModel` from the account's backend, and
prints them through a formatter (`A({models, defaultModelId, currentModelId})`) that is
**human-formatted text, not JSON**, colorized with `chalk` (auto-disabled off a TTY, but not
guaranteed if `FORCE_COLOR` is set in the daemon's environment):

```
Available models

<id> - <displayName>[ (current, default)]
<id-with-no-display-name>
...

Tip: use --model <id> (or /model <id> in interactive mode) to switch. Parameterized models also
accept quoted overrides, e.g. --model 'claude-opus-4-8[context=1m,effort=high,fast=false]'.
```

Each model line is `<id>` alone, or `<id> - <displayName>` optionally followed by a dim
`" (current, default)"`/`" (current)"`/`" (default)"` suffix, where `<id>` is the CLI's
`displayModelId ?? modelId`. The parser: strips ANSI escapes, skips the `Available models` header
and blank lines, stops entirely at the first line starting with `Tip:`, and for each remaining line
takes the text before the first `" - "` (or the whole line if there is none) with any trailing
`" (...)"` parenthetical removed, as the id. This is exact enough that the test fixtures reproduce
the real formatter's output for synthetic model data rather than guessing at a shape. Residual risk
is limited to a future CLI version changing this text format, not "we don't know the format at
all" — noted in the PR, with the ANSI-stripping/ `Tip:`-stop behavior as the main things a future
mismatch would show up in.

This also surfaces a liveness risk worth designing around rather than just noting: with zero stored
Cursor credential at all, `handleModelsList` may attempt an *interactive* login prompt rather than
failing immediately. Spawned headlessly (no TTY, `stdio: pipe`), that prompt cannot be answered and
would otherwise hang. The existing bounded timeout (task 3.1) is therefore load-bearing here, not
just a generic safety margin: it is what turns "hangs forever" into "falls back after N seconds."

### Fallback catalogue is the ids captured in this ticket, not the old guesses

The static fallback list is replaced outright with the real ids from the captured rejection
message (`auto`, `gpt-5.3-codex-low[-fast]`, `gpt-5.3-codex[-fast]`, `gpt-5.3-codex-high[-fast]`,
`gpt-5.3-codex-xhigh[-fast]`, `gpt-5.2`, `cursor-grok-4.6-high-fast`, `composer-2.5`,
`claude-opus-5-thinking-high[-fast]`, `gpt-5.6-sol-high[-fast]`, `gpt-5.6-sol-xhigh`) — all
confirmed accepted as of 2026-09-10, all tagged `source: 'static'`. This list is itself known to be
incomplete (the captured message was truncated), which is fine: the fallback only has to be
correct, not exhaustive, and the dynamic path is what closes the gap whenever it is reachable.

### Labels are derived, not hand-typed

A small humanizer maps recognized family words (`grok`→Grok, `claude`/`opus`→Claude Opus,
`gpt`→GPT, `composer`→Composer, `sol`→Sol, `auto`→Auto) and recognized variant tokens
(`high`/`xhigh`/`low`/`fast`/`thinking`) into a label like "Grok 4.6 (High, Fast)", and falls back
to title-casing unrecognized hyphen/dot-separated segments for any id it doesn't recognize. This
is the direct fix for the failure mode this ticket exists to close: a hand-typed id→label table
would need the same manual updates the id list itself just needed.

### Rejection-message parsing stays a message enrichment, not a second catalogue source

The owner named this a fallback, not the goal. It is implemented purely to make
`TurnResult.error.message` legible (parse "Cannot use this model: `<id>`. Available models:
`<list>`", handling a trailing truncated `, ...`) — it does not feed the cache. Folding it into the
cache would mean a rejected turn silently mutates what the next `listModels()` call returns, which
is a bigger behavior change than this ticket needs and easy to get subtly wrong (e.g. a stale
truncated list overwriting a fuller one from `--list-models`).

### A fallback is loud in the log, not just labelled in the data

A silent fallback is the same failure this ticket exists to fix, one level up: a plausible,
correctly-labelled, static list is indistinguishable from working detection to anyone who isn't
reading the `source` field. So whenever detection fails or its output doesn't parse, the adapter
logs at `warn` with the reason (missing binary / non-zero exit / timeout / unparseable) and a
bounded excerpt (a few hundred chars) of whatever `cursor-agent` actually printed — never a
credential, never more than that excerpt. That excerpt, not a guess, is what lets a future parser
fix be made without anyone needing to run the real CLI. One attempt only: no retry loop and no
second detection path — a loud, legible single failure is what's wanted, not a CLI spawned twice
because the first attempt was inconclusive.

`source: 'detected' | 'static'` was already going to be in the data (task 2/3); this is the
mechanism that makes the distinction reachable by a human, not just present in a field. Actually
rendering it in a picker is a `packages/ui` change and is out of scope here — `GET
/runtimes/:id/models` already returns `source` unchanged (it is a passthrough of `RuntimeModel[]`),
so nothing blocks a later ticket from surfacing it, but this change does not add that UI. Stated
plainly in the PR: today, provenance is visible in the daemon log and in the API's `source` field,
not in any picker's UI copy.

### Parameterized ids are passed through, never synthesized

The `--help` text's `--model` example shows a bracket-parameter form
(`claude-opus-4-8[context=1m,effort=high,fast=false]`), implying the CLI may itself list or accept
such ids. Whatever `--list-models` emits — plain or parameterized — is offered verbatim. This
adapter does not generate parameter combinations itself: doing so would be exactly the kind of
plausible-looking invention that produced the original fictional catalogue.

## Risks / Trade-offs

- **Output-format risk** is now bounded, not open (see Decisions): the format is read from the
  installed CLI's own bundle, not guessed. It could still change in a future `cursor-agent`
  version; the warn-log excerpt is exactly what would make that visible and fixable.
- **The dynamic path authenticates outside the existing per-turn credential singleflight.**
  `ensureFreshCredential` (VS-105, `packages/core/src/runs/credentialFreshness.ts`) already
  serializes concurrent turn spawns against a racing OAuth refresh; `listModels()` is called from
  the daemon route directly (`packages/server/src/routes/daemon.ts`) with no access to that
  machinery (it has no `WorkspaceContext`, only the adapter). A `listModels()` call could in
  principle race a concurrent turn's credential refresh the same way a pre-VS-105 turn could.
  Accepted rather than fixed here: the in-process cache already bounds this to roughly once per 15
  minutes per daemon process (far less exposure than a turn spawn, which happens far more often
  and already goes through the gate), and it is no less safe than `packages/runtimes/opencode`'s
  already-shipped `listModels()`, which spawns its CLI with no freshness coordination at all and no
  cache whatsoever. Threading `listModels()` through the same singleflight would mean giving it
  access to `WorkspaceContext` — a larger, cross-package change or a `RuntimeAdapter.listModels()`
  signature change — is out of scope for this ticket and left as a follow-up if it ever proves to
  matter in practice.
- A 15-minute cache means a plan upgrade or a Cursor-side catalogue change takes up to that long to
  show up without a daemon restart. Acceptable: this is a model *picker* list, not billing state,
  and the previous behavior (fully static, requiring a code change and a deploy) was far slower to
  correct.
- The fallback list will itself eventually drift again if `cursor-agent` changes its lineup and the
  dynamic path is ever unreachable for a long stretch. Mitigated relative to before: the dynamic
  path is tried first on every cache expiry, so drift only shows up when detection itself is
  failing, which is a visible, debuggable condition (the daemon's own logs), not a silent one.

## Open Questions

None. The output format is resolved by static analysis (see Decisions). The credential-singleflight
gap is a disclosed, bounded, precedented risk (see Risks / Trade-offs), not a deferred decision —
accepting it is the decision.
