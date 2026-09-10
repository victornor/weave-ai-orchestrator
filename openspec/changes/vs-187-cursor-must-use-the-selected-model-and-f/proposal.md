## Why

Captain, 2026-09-10: a workspace's conductor is on runtime `cursor` with model Grok 4.6 selected in Settings. A turn produced no real output in chat; the Cursor dashboard a minute later showed usage on **Claude 4.5 Opus High Thinking**, not Grok. VS-165 (shipped earlier the same day) already fixed the stale model catalog and made `buildArgs` forward `--model <id>` for any named, non-`auto` selection — so the requested id is on argv. But nothing in the adapter checks that `cursor-agent` actually honored it: if the CLI cannot run an id (unentitled plan, retired slug, whatever), it can silently substitute a different, billed model and still exit 0, and the adapter reports success on the wrong model with no signal to anyone.

Separately, VS-167 found `cursor-agent` can spawn and then emit **zero** `stream-json` lines at all — not even `system.init` — and hang. Today nothing in the adapter notices; the run only stops when the daemon's generic watchdog fires `silence_interrupt` at the configured `silenceTimeoutSec` (default 600s / 10 minutes), so a completely dead process looks like a live chat for up to ten minutes before anything tells the human.

## What Changes

- After `cursor-agent`'s `system.init` line reports which model actually started the session, compare it against the model that was requested (when a named, non-`auto` model was asked for). A mismatch — the reported model doesn't contain the requested model's family name (`grok`, `opus`, `composer`, `fable`, `gpt`, `sonnet`, …) — interrupts the turn immediately and reports a `model_mismatch` error instead of a normal-looking success on the wrong (and already-billed) model. `auto` is exempt: picking for itself is its entire point.
- `runTurn` tracks whether `cursor-agent` has produced *any* stdout or stderr line at all. If nothing has arrived within a short grace period (well under the existing 600s daemon-wide silence timeout), the adapter interrupts the process itself and reports a `no_output` error, rather than waiting for the generic watchdog.
- Both new failure paths report a real error on the run (`error.code`, clear message) so conductor chat gets a visible failure, never continued silence.
- No change to `buildArgs`' argv construction (VS-165 already covers "the selected model appears on argv"); this change is about verifying what actually happened after spawn.

## Capabilities

### Modified Capabilities

- `cursor-runtime/adapter`: a named model's turn verifies the CLI's own reported model against the request and fails visibly on a mismatch; a turn that produces no output at all fails within seconds instead of the full daemon silence window.

## Impact

- `packages/runtimes/cursor/src/adapter.ts` (`runTurn`): model-mismatch check against `system.init`/`session.resumed` events, no-output grace timer.
- `packages/runtimes/cursor/src/args.ts`: export the existing `namedModel` helper so `adapter.ts` can reuse the same "what model, if any, was requested" resolution instead of duplicating it.
- `packages/runtimes/cursor/test/*`: fake CLI updated to echo back the `--model` it actually received (so existing named-model tests keep passing under the new check); new tests for a mismatched reported model and for a CLI that prints nothing.
- No DB, API, docs or other-runtime change (PLAN §8.3's Cursor row documents invocation shape, not turn failure modes). No live `cursor-agent` invocation anywhere in verification.
