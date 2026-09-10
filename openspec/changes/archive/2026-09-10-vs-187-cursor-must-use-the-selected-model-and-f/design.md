## Context

`packages/runtimes/cursor` (VS-155, fixed up by VS-165 the same day as this ticket) already:

- forwards `--model <id>` on argv for any named, non-`auto` selection, and omits it for `auto`/unset;
- parses `cursor-agent`'s `stream-json` output, including a `system`/`init` line whose `model` field is the CLI's own report of what session it started (`packages/runtimes/cursor/src/events.ts` → `session.started`/`session.resumed` events).

Neither of those is enough on its own. VS-165's own design notes recorded that Settings intentionally still accepts a model id the static catalog doesn't offer (model-selection is free text), so nothing in the adapter can reject an id as "invalid" before spawning — the only ground truth is what `cursor-agent` itself reports back once it starts. Captain's 2026-09-10 report (Grok 4.6 requested, Opus 4.5 billed, no visible output) is exactly that: the CLI accepted `--model grok-4-6`, silently ran something else, and the turn still looked like an ordinary (if empty) success to everything downstream.

Separately, VS-167 recorded a `cursor-agent` invocation that spawns and then writes nothing at all to stdout or stderr — not even the `system.init` line. Nothing adapter-side notices this; the daemon's own `packages/core/src/supervisor/index.ts` `watchdog()` is the only thing that eventually reacts, and only after `defaults.silenceTimeoutSec` (default 600s, minimum 60s, a single workspace-wide knob) of no `run_events` activity. Ten minutes of apparent silence in conductor chat for a completely dead process is the exact complaint in this ticket ("fail fast if it prints nothing").

Both defects are only observable from *within* `runTurn`, after spawn, from the raw stdout/stderr stream — not from `buildArgs`, which is already correct and stays untouched.

## Goals / Non-Goals

**Goals:**
- A turn on a named model whose actually-started session reports a materially different model interrupts immediately and reports a clear `model_mismatch` error, instead of finishing as an ordinary success.
- A turn whose process produces zero output at all fails within a few seconds, not the full `silenceTimeoutSec` window.
- Both stay adapter-local, spawn-free to verify (fake CLI + scratch config only, per the standing rule against live `cursor-agent` runs), and don't regress the `auto`/named-model tests VS-165 already shipped.

**Non-Goals:**
- Rejecting a model id before spawning because it is absent from the static `MODELS` catalog. VS-165 deliberately kept free-text model ids working (the catalog is a best-effort, spawn-free approximation of an account-gated live picker); adding a pre-spawn allowlist would silently break that and is not what "fail visibly" is asking for. The check here is entirely about what the CLI *itself* reports having run, not about our own catalog.
- Changing the workspace-wide `silenceTimeoutSec` / `turnTimeoutSec` defaults, or adding a new per-runtime config surface for the grace period. This is specifically about Cursor's observed print-mode failure mode (VS-167); a local constant in the adapter is the appropriately narrow fix.
- Any live `cursor-agent` invocation to confirm the exact strings the CLI reports for each model id — not available under the "never spawn against host credentials" rule. The matching rule below is deliberately conservative about that unknown.

## Decisions

### Detecting a wrong model: match on the model id's family word, not an exact string

`cursor-agent`'s `system.init.model` field is a free-form display string (fixtures — synthetic, not live recordings — show `"Auto"`, `"Claude 4 Sonnet"`; captain's screenshot showed `"Claude 4.5 Opus High Thinking"` for what our catalog calls `opus-5`). There is no live CLI available to pin the exact string per catalog id, and guessing one narrows the check into a source of false failures on perfectly correct runs.

Instead, `runTurn` extracts the requested model's first alphabetic run (`grok-4-6` → `grok`, `sonnet-4-thinking` → `sonnet`, `opus-5` → `opus`, `composer-5-6` → `composer`, `fable-5-1` → `fable`, `gpt-5` → `gpt`) and checks that this token appears (case-insensitively) somewhere in the reported `model` string. This is deliberately loose — it only catches a *different model family* being substituted (Grok requested, Opus/Claude/GPT reported), which is exactly captain's incident and the only thing "silently running a different, billed model" means in practice. It cannot catch a wrong *variant* of the same family (e.g. requesting `opus-5` and silently getting a different Opus tier) — there is no spawn-free way to know Cursor's exact display convention well enough to check that without risking false positives on correct runs, and that gap is called out here rather than hidden.

`auto` (and no model at all) is exempt from this check entirely: `auto` means "let Cursor choose," so whatever it reports is definitionally correct.

On a mismatch, the turn is interrupted at that point (the same `cancel('interrupt')` path a human/supervisor cancellation uses) rather than left to run to completion on the wrong model — it cannot undo whatever was already billed for the `init` exchange itself, but it stops before any further (potentially much more expensive) tool-calling work happens on a model nobody asked for.

### Detecting silence: an adapter-local grace timer, independent of the daemon watchdog

`runTurn` already owns the `onLine` callback for every stdout/stderr line `cursor-agent` writes. A boolean flag flips true on the very first line seen (either stream — even a stderr complaint is proof the process isn't completely dead). A timer started at spawn checks that flag after a short grace period; if nothing has arrived, it interrupts the process itself and reports a `no_output` error.

The grace period is a local constant (20s) — comfortably under the daemon's own `silenceTimeoutSec` floor (60s minimum, 600s default) so this always fires first for Cursor specifically, without changing that workspace-wide setting or how any other runtime behaves. It is capped at `input.limits.timeoutMs` so it can never be larger than the turn's own overall budget (relevant for short-timeout tests). Tests override it via `input.options['noOutputGraceMs']` — the same test-only seam `extraArgs` already uses on `TurnInput.options`, which reaches the adapter unvalidated (the engine only ever populates `options.liveInput` in production, confirmed by reading `packages/core/src/runs/engine.ts`).

This does not touch `TurnResult.timedOut`: that field, when true, makes `packages/core/src/runs/engine.ts`'s `finalize()` overwrite whatever `error` is set with a generic `timeout`/`tooling` pair (`r?.timedOut` is checked before `r?.error`). Leaving `timedOut` as whatever `spawnLines` naturally returns (`false`, since our own `cancel('interrupt')` isn't the `opts.timeoutMs` firing) is what lets the specific `no_output` error code survive to the run row.

### Both failures are plain `TurnResult.error`s, not a new run status

Both new conditions produce `{ code, family: 'tooling', message }` on the returned `TurnResult`, exactly like the existing `classifyError` path — `finalize()` already turns any `TurnResult.error` into a `failed` run with that code and family (`packages/core/src/runs/engine.ts` line ~418). No core, DB or API change is needed; conductor chat sees a failed turn with a legible reason instead of silence, through the same path every other adapter failure already uses.

## Risks / Trade-offs

- **Family-word matching can miss a same-family wrong variant.** Accepted (see Decisions) — the alternative is guessing an exact display-string contract with no live CLI to verify it against, which the standing rule forbids and which is more likely to cause new false failures than to catch anything real.
- **20s grace could theoretically fire on a slow-starting but otherwise fine process.** Cursor's own `-p` print-mode docs describe the `system.init` line as the first thing written; 20s is generous against that and still tiny against the 600s default silence window it replaces for this one symptom.
- **Interrupting on mismatch still bills the `init` exchange.** Unavoidable without a live CLI to pre-validate against; stopping immediately after detection is the best available bound on further cost.

## Migration Plan

None. Behavior-only change inside one adapter's `runTurn`; no schema, no config, no API surface. Rollback is a revert.

## Open Questions

None blocking. Whether Cursor's display strings ever collide across families in a way the family-word check would miss is unverifiable without a live CLI and is called out as a known gap above, not something the ticket owner needs to decide now.
