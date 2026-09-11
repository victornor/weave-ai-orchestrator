## Why

`effort` already flows from workspace/daemon model settings into `TurnInput` and out as a CLI flag (`claude --effort`, `codex -c model_reasoning_effort=`, `opencode --variant`). Nothing enumerates which values a given model accepts, and the web Models UI never offers the field — so a thinking level is either guessed as free text on the CLI or cannot be chosen at all. Captain hit this on OpenCode: the TUI lets you pick high/low/medium/extra-high per model, but AgentConductor only lists models.

## What Changes

- **`RuntimeModel` carries the efforts each model accepts**, populated by the adapter that already lists that model. Detected vs static stays distinguishable via the existing `source` field (efforts on a row come from the same path as the row; they are never a guessed menu bolted onto a detected catalogue).
- **Three honest states, not one list:** a non-empty `efforts` array is a picker; an empty array means this model is known to take none (control absent); omitted `efforts` means unknown (free text, same as today's CLI).
- **Thinking level is choosable next to the model** on workspace Models, daemon Models overlays, and the worker-options add form (they already share `ModelSettingFields` / `WorkerOptionsEditor`). It stays optional. Changing model drops an effort the new model does not list.
- **Per-adapter discovery, not a hardcoded universe.** OpenCode: `opencode models --verbose` already JSON-dumps each model's `variants` object. Claude: the installed CLI's catalog has per-model `supportedEffortLevels` (universe `low|medium|high|xhigh|max`, filtered per model) — no list command; populate the existing static table from that catalog the same way VS-129 did for context windows. Codex: `codex debug models` dumps a catalog whose `Model` carries `supportedReasoningEfforts` (use `--bundled` so it does not refresh over the network). Gemini and Cursor: established that they do not consume a separate effort flag — report `[]`, do not invent a menu.
- **How `effort` is passed to any CLI does not change.** Existing `buildArgs` tests keep asserting today's flags.

## Capabilities

### New Capabilities

- `model-selection/effort-catalogue`: the model catalogue carries per-model efforts, populated by each adapter from that runtime's own discovery path, with detected/static honesty and no guessed menus.

### Modified Capabilities

- `model-selection/workspace-model-settings`: the web Models section offers thinking level next to each setting's model, constrained to what that model reports.
- `model-selection/worker-options`: the worker-option editor (workspace catalog and daemon catalog overlay) offers the same thinking-level control.
- `model-selection/daemon-overrides`: the daemon Models conductor/workers rows offer the same thinking-level control (they already reuse the workspace setting fields).

## Impact

**Code.** `packages/runtime-sdk` (`RuntimeModel`); `packages/runtimes/{opencode,claude,codex,gemini,cursor}` `listModels` (and OpenCode's `parseModels`); `packages/ui` `api/types.ts`, `Settings.tsx` (`ModelSettingFields`, `WorkerOptionsEditor`); `docs/API.md` for `GET /runtimes/:id/models`. No new route. `ModelSettingSchema.effort` is unchanged.

**Tests.** Adapter parse fixtures from captured CLI bytes (OpenCode `--verbose`, Codex debug-models JSON); Claude static table assertions; Gemini/Cursor report `[]`; existing `buildArgs` effort-flag tests stay; UI picker / free-text / absent / optional / model-change-clears-stale-effort in `models.test.tsx`. Both vitest suites.

**CLI.** `conductor models set --effort` already exists as free text and stays; this change is the catalogue plus the web picker.
