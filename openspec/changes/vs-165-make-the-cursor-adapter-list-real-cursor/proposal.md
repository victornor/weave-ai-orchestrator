## Why

Captain, 2026-09-10: Settings for runtime `cursor` shows Auto, GPT-5, Sonnet 4 Thinking, Composer 2.5 — not what this host's `cursor-agent` offers (Grok 4.6, Opus 5, 5.6, Fable 5.1, Auto, …). Picking Auto and sending never starts a working turn, even though the CLI is installed.

VS-155 shipped a static catalog taken from 2026-09-09 docs examples, and a print-mode spawn that feeds Claude-shaped NDJSON `user` frames on an open stdin. Both are wrong for CLI 2026.09.08-6caf4ff: the live picker is account-gated and those four ids are stale; the binary has no `--input-format`, and published headless docs pass the prompt as an argv operand. Open stdin without EOF is the print-mode hang that looks like a silent no-op.

## What Changes

- Replace the Cursor adapter's static `listModels` catalog with the documented live set for this CLI (captain's 2026-09-10 picker plus `--model` help examples). Still spawn-free: `cursor-agent --list-models` / `models` authenticates against the backend and can rotate the shared OAuth login.
- `auto` (and an unset model) omits `--model`, so Auto means the CLI chooses. A named id is passed through as `--model <id>`.
- Print-mode turns pass the prompt as an argv operand (`-- <prompt>`, or closed plain-text stdin when oversized). Stdin is not kept open. `streamingInput` is false; attach queues. This reverses VS-155's unverified live-stdin bet so a selected model actually starts a run.
- Cloud Agent handoff and `--worktree` stay forbidden.
- Verification uses a fake `cursor-agent` and scratch config. Exact `--model` slugs that cannot be pinned from the bundle without spawning are marked unverified in the PR.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cursor-runtime/adapter`: catalog matches the live CLI picker; Auto omits `--model`; print-mode prompt is argv so the turn starts; no live stdin channel.

## Impact

- `packages/runtimes/cursor` (`adapter.ts` MODELS, `args.ts` prompt/`--model`, capabilities, tests, fake CLI).
- `docs/PLAN.md` §8.3 Cursor row (prompt is argv, not Claude stdin frames).
- No DB, API, or other-runtime change. No Cloud Agent, no `--worktree`.
