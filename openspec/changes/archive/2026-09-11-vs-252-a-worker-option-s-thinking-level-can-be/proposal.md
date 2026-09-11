## Why

The add-worker-option form offers a thinking level, but the editable catalog row VS-236 added does not, so an effort chosen at creation is invisible afterwards and cannot be changed. Worse, changing a row's model silently drops an incompatible effort — `settingAfterModelChange` clears it correctly, but with no field on the row there is nothing to show the operator that it happened.

## What Changes

- **Existing catalog rows gain the thinking-level field.** `WorkerOptionRow` (shared by the workspace catalog and the daemon overlay, since both render the same `WorkerOptionsEditor`) shows the option's current effort and lets it be changed, persisted with the option's id and description unchanged.
- **The three states are reused, not duplicated.** The picker / hidden / free-text derivation that VS-228 gave the conductor and workers settings — and that the add form already repeats inline — is extracted into one shared helper so all four callers (settings, daemon overlay, add form, existing row) agree.
- **An unconfigured option shows no thinking-level control.** With no runtime there is no model to ask which efforts it accepts, and an unconfigured option cannot run a worker at all, so the control is hidden for the same reason its model select is disabled (VS-236). Showing it would imply a choice that can never take effect.
- **A dropped effort is announced on the row.** When a model change discards an effort the new model does not list, the row says which value was cleared and why, instead of resetting silently.
- **A row with no effort implies none.** The picker renders its `default (unset)` entry and the free-text box renders empty, so an option with no effort looks unset rather than as if one were stored.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-selection/worker-options`: an existing catalog option now shows and can change its thinking level; a discarded effort is surfaced on the row; and the thinking-level states come from one shared rule rather than a per-caller copy.

## Impact

**Web only.** `packages/ui/src/routes/Settings.tsx` — `WorkerOptionRow` gains the field and the dropped-effort notice; the picker/hidden/free-text derivation moves into a shared helper used by `ModelSettingFields`, the add form and the row. `packages/ui/src/test/models.test.tsx` gains coverage. No schema change (`WorkerModelOptionSchema` already carries `effort`), no route change, no core change, no change to how effort is resolved at launch, and no change to the add form, conductor, or workers settings behavior.

**Verification.** `pnpm lint`, `pnpm typecheck`, and `pnpm test` (core suite and UI suite), both suite blocks pasted verbatim.
