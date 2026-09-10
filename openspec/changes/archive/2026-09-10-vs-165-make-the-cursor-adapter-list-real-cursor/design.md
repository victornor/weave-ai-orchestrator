## Context

VS-155 added `packages/runtimes/cursor` (`cursor-agent`, never `agent`). Two defects captain hit on 2026-09-10:

1. `listModels` is a stale static four (`auto`, `gpt-5`, `sonnet-4-thinking`, `composer-2-5`). Settings / `GET /runtimes/cursor/models` shows those, not the live picker (Grok 4.6, Opus 5, 5.6, Fable 5.1, Auto, …).
2. Selecting Auto and sending never starts a run.

Evidence, no live CLI (charter / VS-155 method: published docs + `strings`/`rg` on `~/.local/share/cursor-agent/versions/2026.09.08-6caf4ff/`):

- `--model <model>` help: `e.g., gpt-5, sonnet-4-thinking`. Parameterized form `claude-opus-4-8[context=1m,effort=high,fast=false]`. `auto` is not an example.
- `--list-models` and `cursor-agent models` both call `handleModelsList`, which authenticates then fetches `availableModels` for **this account**. Output is `displayModelId || modelId` plus `displayName`. Spawning it from `listModels` would use the workspace credential symlink and can rotate OAuth. VS-155 forbade that; keep it.
- Headless docs (2026-09-10): every `-p` example passes the prompt as an argv operand. No `--input-format` in the binary (VS-155 already recorded this). Print mode with stdin open and no argv prompt is the hang that matches "silent no-op".
- Engine always sets `options.liveInput` from `defaults.liveInput` (true). Cursor `buildArgs` currently treats that as open stdin + JSON frame, so every cursor turn deadlocks even when the model id is fine.

## Goals / Non-Goals

**Goals:**

- Settings lists the models this CLI actually offers, including Auto.
- Auto and at least one named captain model produce a spawn that starts (argv prompt, closed stdin), against a fake CLI.
- `auto` / unset omit `--model`.
- Cloud Agent handoff and `--worktree` remain banned.
- Tests never launch the real `cursor-agent`.

**Non-Goals:**

- Spawning `cursor-agent --list-models` / `models` from `listModels`.
- Restoring a live stdin attach channel (no `--input-format`; follow-up if the owner verifies a protocol).
- Cursor Cloud Agents, ACP, `cursor-agent worker`.
- Other runtimes' catalogs.
- `contextWindowTokens` (still unknown without a spawn-free catalog).

## Decisions

### Catalog stays static; contents match the live picker

`listModels` remains `source: 'static'` and MUST NOT spawn. OpenCode's live `opencode models` is not a precedent here: Cursor's list authenticates.

Replace MODELS with a documented catalog for CLI 2026.09.08. Apply pins `--model` slugs from a deeper bundle pass (model-service / `displayModelId`). Working set from captain's picker plus help examples:

| id (working) | label | why |
|---|---|---|
| `auto` | Auto | captain; listed, but see `--model` below |
| `grok-4-6` | Grok 4.6 | captain |
| `opus-5` | Opus 5 | captain |
| `composer-5-6` | Composer 5.6 | captain's bare "5.6"; also plausible as Opus 5.6 — apply pins |
| `fable-5-1` | Fable 5.1 | captain |
| `gpt-5` | GPT-5 | `--model` help example |
| `sonnet-4-thinking` | Sonnet 4 Thinking | `--model` help example |

Drop `composer-2-5` (stale, not in the live picker). Keep `gpt-5` / `sonnet-4-thinking` because the binary still names them.

If a slug cannot be established without spawning, keep the working id, document the guess in the PR as unverified, and let the owner confirm with `cursor-agent --list-models` (they run it, not the ticket).

Captain's "5.6": either Composer 5.6 or Opus 5.6. Apply prefers a slug that appears in the bundle; if neither does, ship `composer-5-6` and mark unverified.

### Auto omits `--model`

`buildArgs` passes `--model` only when `input.model` (else `options.model`) is a non-empty string other than `auto` (case-insensitive). Unset, `''`, and `auto` mean the CLI chooses. Settings can keep showing Auto as id `auto`; storing that id must not produce `--model auto`.

### Print-mode prompt is argv; no live stdin

Reverse VS-155's unverified Claude-frame channel:

- Prompt is `-- <prompt>` when it fits `MAX_ARGV_PROMPT`; otherwise closed plain-text stdin (existing `liveInput: false` path).
- `stdinMode: 'close'`. No `TurnHandle.send`.
- `streamingInput: false` so attach queues (honest). Cursor `buildArgs` ignores `options.liveInput` — the engine will keep sending `true`.
- `userFrame` may remain unused; it MUST NOT be the default prompt path.
- Fake CLI tests: the fake reads the argv prompt (or closed stdin) and emits synthetic stream-json, then exits. A test asserts a turn with `model: 'auto'` and a turn with a named id both complete `exitCode === 0` against that fake. Never the real binary.

Existing scenario names under the live-input requirement are kept (OpenSpec matches by name). WHEN/THEN change to the argv / no-`send` contract.

### Cloud Agent and worktree bans unchanged

No `&` prefix, no `acp`/`worker`, drop `--worktree`/`-w`/`--worktree-base` from extraArgs.

## Risks / Trade-offs

- **Slug drift.** Account-gated catalogs change. Mitigation: static list + PR unverified note; Settings still accepts a model the list does not offer (`model-selection` already).
- **`--model auto` might actually be valid.** Help does not name it. Omitting the flag matches "runtime chooses" and cannot be worse than today's hang. If the owner later sees Auto mis-route, add `--model auto` as a one-line follow-up.
- **Mid-turn attach on cursor queues.** VS-155 wanted Claude-like attach; the CLI cannot honor it. Ticket VS-165 requires a run that starts. Plan approval is the gate for dropping the live channel.
- **Oversized prompt on stdin.** Closed stdin as plain text (not a JSON frame) matches the published "piped stdin is the prompt" behaviour.

## Migration Plan

No migration. Workspaces already on `cursor` / `auto` start working after upgrade. A stored model of `gpt-5` / `sonnet-4-thinking` / `composer-2-5` still launches; `composer-2-5` may 404 on the CLI until the human picks a live id.

Rollback is revert. Catalog goes stale again; live-stdin hang returns.

## Open Questions

None that block the spec. Exact slugs for Grok 4.6 / Opus 5 / 5.6 / Fable 5.1 are apply-time pins from the bundle, unverified against live `--list-models`.
