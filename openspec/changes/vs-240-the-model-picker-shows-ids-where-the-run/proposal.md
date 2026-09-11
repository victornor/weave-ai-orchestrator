## Why

The opencode adapter builds every detected `RuntimeModel` as `{ id, label: id, ... }`
(`packages/runtimes/opencode/src/adapter.ts:100`), throwing away the `name` field the CLI's own
`--verbose` output already carries (e.g. id `deepseek-flash` with `"name": "DeepSeek V4.1
Flash"`). The cursor adapter has the same discard one step removed: `cursor-agent --list-models`
prints `<id> - <displayName>` per line, but `parseListModelsOutput` keeps only the id and then
re-derives a label from it via a hand-rolled humanizer, ignoring the real `<displayName>` already
in the line it just read. Either way, a human picking a model from the UI sees ids that carry no
signal about recency or capability — captain hit this directly on 2026-09-11, unable to tell which
opencode id was the newer "V4.1 Flash" release without cross-referencing opencode's own registry
by hand. On top of that, the four model `<select>` dropdowns in `packages/ui` render `{m.label}`
only — even where a real label already exists, the id that actually gets written to config is
never shown, so a human confirming "did I pick the right one" still cannot see the value being
stored.

## What Changes

- `packages/runtimes/opencode/src/adapter.ts`'s `parseModels` sets `label` from the parsed JSON
  object's `name` field when present and non-empty, falling back to `id` exactly as today when a
  line has no JSON block (the non-verbose `provider/model`-only listing).
- `packages/runtimes/cursor/src/models.ts`'s `parseListModelsOutput` keeps the `<displayName>`
  half of a `<id> - <displayName>` line and uses it as-is for `label`, instead of discarding it
  and re-deriving one from the id. A bare id line (no ` - `) still falls back to the existing
  `humanize()`-derived label, unchanged.
- Codex, Claude and Gemini are unchanged: codex's `parseBundledModels` already uses the CLI's
  `display_name` field; Claude and Gemini use hand-maintained static catalogues with real names,
  not an id-copy.
- A new shared helper formats a `RuntimeModel` for display as `"label (id)"` when the label
  differs from the id, or just the id when it does not (i.e. no better name was available) —
  reused by every model `<select>` in `packages/ui` (`Onboarding.tsx`, three spots in
  `Settings.tsx`) so the id that lands in config is always visible next to the name a human
  recognizes.
- No new process launch, cache read, or registry fetch is introduced anywhere. Every adapter
  still makes exactly the calls it makes today.

## Capabilities

### New Capabilities
- `model-selection/detected-model-labels`: a detected model's `label` reflects the runtime's own
  reported name when the adapter's already-parsed listing output carries one, never a value
  invented purely from the id; and the model picker UI shows both the label and the id together
  so neither is hidden.

### Modified Capabilities
- `cursor-runtime/adapter`: the "Model ids get a derived human-readable label" requirement is
  superseded by preferring the CLI's own reported display name (parsed from `--list-models`
  output) over the algorithmic humanizer, falling back to the humanizer only when no display name
  was present in the line.

## Impact

- `packages/runtimes/opencode/src/adapter.ts` (+ its tests / fixtures — already-recorded fixtures
  cover the exact `deepseek-flash` shape from the ticket).
- `packages/runtimes/cursor/src/models.ts` (+ its tests).
- `packages/ui/src/lib/runtime.ts` (new formatter) and its four call sites in
  `packages/ui/src/routes/Onboarding.tsx` and `packages/ui/src/routes/Settings.tsx`.
- No API, config schema, or `RuntimeModel` shape change. No change to what value is stored in
  config (still the id).
