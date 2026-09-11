## Context

See `proposal.md` for motivation. The relevant code is one file: `packages/ui/src/routes/Settings.tsx`.

Two derivations of the thinking-level state already exist and differ only in plumbing:

- `ModelSettingFields` (lines 854–996) computes `custom`, `efforts` via `effortsForModel`, then an `effortMode` of `picker | hidden | freetext` from the reported efforts and the stored effort. It renders a picker, nothing, or a committable free-text input.
- `WorkerOptionsEditor`'s add form (lines 1083–1236) recomputes the same three states inline over `optionEfforts`, before a value exists to clash with.

`WorkerOptionRow` (lines 998–1081) has neither. Its model change already calls `settingAfterModelChange`, which clears an incompatible effort, but nothing on the row reads or shows `option.effort`.

`WorkerOptionsEditor` is rendered by both `ModelsSection` (workspace catalog) and `DaemonWorkerOptions` (daemon overlay), so a single change to the row reaches both.

## Goals / Non-Goals

**Goals:**
- One shared derivation of the picker / hidden / free-text state, used by the settings fields, both worker-option call sites, and the row.
- The row shows its stored effort, changes it, and announces a dropped one.
- No behavior change to the settings, add form, resolution at launch, or schema.

**Non-Goals:**
- A new route, schema field, or core change.
- Touching `packages/render`, the TUI, or the CLI.
- Changing `settingAfterModelChange`'s clearing rule — only surfacing what it already does.

## Decisions

### Extract the derivation, not the whole field

Add a small pure helper next to the existing model helpers in `Settings.tsx`:

```ts
type EffortMode = 'picker' | 'hidden' | 'freetext';
function effortMode(efforts: string[] | undefined, stored: string | undefined): EffortMode {
  if (efforts && efforts.length > 0) return !stored || efforts.includes(stored) ? 'picker' : 'freetext';
  if (efforts && efforts.length === 0) return 'hidden';
  return 'freetext';
}
```

This is byte-for-byte the rule `ModelSettingFields` already applies, with the `custom` case folded into `effortsForModel` returning `undefined`. `ModelSettingFields` and the add form are rewritten to call it, and the row calls it too. Extracting a helper rather than a shared `<ThinkingLevelField>` component keeps the three call sites' different state models (committed setting, local draft, row patch) intact — the picker, the free-text input and their save affordances differ enough that a shared component would need flags for all of them. The rule is what drifted, so the rule is what is shared.

Alternative rejected: a shared presentational component. It would need to abstract the committable field, the disabled overlay case, and the add form's local state, and the extra indirection buys nothing when the derivations are the thing that must agree.

### Hidden, not disabled, while unconfigured

An option with `runtime == null` has no model, so `effortsForModel` returns `undefined` and the free-text branch would otherwise render. The row instead renders no thinking-level control at all while unconfigured. Reason: the option cannot run a worker (VS-236), so any effort typed there could never take effect, and the model select is already disabled for the same reason. A visible control would claim a choice the operator cannot use.

### The dropped-effort notice is row-local state

`WorkerOptionRow` holds `const [discarded, setDiscarded] = useState<string | null>(null)`. Its model `onChange` compares `option.effort` with `settingAfterModelChange(...)`'s `effort`; when a non-empty value is dropped it records it, otherwise it clears the notice. The notice renders under the fields as a `role="status"` line naming the value. It is not persisted and not part of the saved option — it is feedback about the edit just made, matching the transient `CommitStatus` idiom already on the page.

Alternative rejected: a toast. Toasts are for out-of-band events (`ChannelsSection`); this is inline feedback about the control the operator just used, and the spec ties the notice to the row.

### `default (unset)` is the "no effort" affordance

The picker already carries an empty-string option rendered as `default (unset)`, and the free-text input is empty when no effort is stored. The row reuses both verbatim, which satisfies "renders without implying one is set" with no new affordance.

## Risks / Trade-offs

- **[Risk] Moving the derivation changes the settings behavior by accident.** → The helper is the existing expression, and the existing VS-228 tests (`models.test.tsx`, "Settings — thinking level next to the model") pin picker, hidden, free-text, stale-effort-as-free-text and clear-on-model-change. They must stay green unchanged.
- **[Risk] A stale stored effort on a row (one not in the current list) is silently shown as free text.** → Same behavior as the settings today: the value is preserved and editable, not dropped, until the operator changes the model. No new rule.
- **[Trade-off] No notice on initial page load for an already-inconsistent option.** → The notice is about the edit that dropped a value; a value that was never there has nothing to announce. The row still shows `default (unset)`.

## Migration Plan

None. UI-only, no persisted field added or re-interpreted. Rollback is a revert of the PR.

## Open Questions

None.
