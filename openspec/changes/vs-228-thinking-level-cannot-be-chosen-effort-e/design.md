## Context

See `proposal.md` for motivation. `effort` already exists on `ModelSettingSchema`, `TurnInput`, and three adapters' `buildArgs` (`claude --effort`, `codex -c model_reasoning_effort=`, `opencode --variant`). `GET /runtimes/:id/models` already returns `adapter.listModels()` unchanged. The web Models UI (`ModelSettingFields` / `WorkerOptionsEditor` in `packages/ui/src/routes/Settings.tsx`) never reads or writes `effort`. The CLI already has `--effort` as free text.

This worker did not spawn any coding CLI. Flag and catalogue facts below are from static analysis of the installed binaries (the VS-99 / VS-129 `strings` method) plus in-repo adapter source.

Installed at investigation (2026-09-11): OpenCode 1.18.30, Claude Code 2.1.266, Codex 0.153.4, Gemini CLI 0.59.0, cursor-agent 2026.09.10-fd3934a.

## Goals / Non-Goals

**Goals:**
- One `RuntimeModel` shape that can carry per-model efforts with three honest states (list / none / unknown).
- Each adapter fills that field from a path established below, or reports none/unknown rather than guessing.
- One UI control in the shared Settings fields, so workspace Models, daemon overlays, and worker-options add all get it.
- Existing `buildArgs` effort forwarding stays byte-for-byte the same, pinned by the tests that already exist.

**Non-Goals:**
- Changing how any CLI is invoked (flag names, when the flag is omitted, Gemini `thinkingLevel` in settings.json, Cursor parameterized ids).
- A new settings page, a new HTTP route, or a TUI picker.
- Parsing Cursor model-id suffixes (`-high`, `-xhigh`) into a fake effort dimension — those ids already appear as distinct models.
- Launching a coding CLI from this ticket against live credentials. Apply-phase adapter tests use a fake binary / captured fixture, except OpenCode's existing `listModels` test which already spawns `opencode models` because that listing needs no account.

## Decisions

### `efforts?: string[]` on `RuntimeModel`, three states, no second source tag

```ts
export interface RuntimeModel {
  id: string; label: string; provider: string;
  source: 'detected' | 'static';
  tier?: string; notes?: string; contextWindowTokens?: number;
  /** Present = known (possibly empty). Omitted = unknown. */
  efforts?: string[];
}
```

- non-empty → picker
- `[]` → hide the control (known to take none)
- omitted → free text

Rejected a parallel `effortsSource` field: the ticket asked for honesty consistent with the existing `source` field, and mixing a detected model list with a guessed effort menu is the failure mode to forbid. Efforts on a row always come from the same path that produced the row, so `source` already answers "detected or assumed".

Rejected putting a runtime-wide enum on `configSchema().properties.effort` as the picker source (Claude and Codex already have one): that is exactly the hardcoded universe captain ruled out.

### Per-adapter discovery (what was found, and what we will do)

**OpenCode — detect from `opencode models --verbose`.**
Today `listModels` runs `opencode models` and keeps lines matching `provider/model`. The CLI (1.18.30) already has `--verbose`: after each id it writes `JSON.stringify` of the provider model object. That object is schema-typed with `variants: Record<string, Record<string, Any>>`. The TUI's thinking-level picker is `Object.keys(model.variants)` (slash command `variants`; event `{type:"variants", variants}`). `--variant` is documented as "model variant (provider-specific reasoning effort, e.g., high, max, minimal)".

Apply: pass `--verbose`, parse id lines plus the following JSON object, set `efforts` to the variant keys (skip entries with `disabled: true`). Empty `variants: {}` → `[]`. Fallback static list (binary missing / parse failure) omits `efforts` (unknown, free text) — do not copy OpenCode's example strings onto the fallback rows. Parser tests MUST be written from a captured `opencode models --verbose` dump (existing `listModels` test already spawns the real binary; capture during apply into `packages/runtimes/opencode/test/fixtures/`), not a hand-written JSON that assumes a `variants` shape.

**Claude — static table from the CLI catalog, not a global enum.**
There is no `claude --list-models`. `--effort <level>` exists; unrecognized values print `Unknown --effort value '<…>'` / `Ignoring unrecognized effort "…"; valid: …`. The baked-in catalog (same object VS-129 read for `context.window`) has `default_effort` in `low|medium|high|xhigh|max` and capabilities flags `effort`, `xhigh_effort`, `max_effort`. The picker the CLI itself builds is `["low","medium","high","xhigh","max"].filter` dropping `max` unless the model supports it and `xhigh` unless the model supports it. `supportedEffortLevels` is the per-model field.

Apply: keep `listModels` static (`source: 'static'`). For each id already in `MODELS`, set `efforts` from that catalog the same spawn-free way VS-129 set `contextWindowTokens` — extract during apply from `/home/user/.local/share/mise/installs/claude/<current>/claude`, do not copy today's `configSchema` enum onto every row. A custom model id the table does not list omits `efforts` (free text). `configSchema().properties.effort.enum` can stay as documentation of the universe; it is not the picker source.

**Codex — detect from `codex debug models --bundled` when the binary is present, else static with efforts omitted.**
No `--list-models`. The app-server `Model` struct carries `supportedReasoningEfforts` and `defaultReasoningEffort`. Rejection text: `Reasoning effort \`…\` is not supported for model \`…\`. Supported reasoning efforts: …`. CLI: `codex debug models` "Render the raw model catalog as JSON"; clap flag `BUNDLED` = "Skip refresh and dump only the bundled catalog shipped with this binary". Today's adapter `MODELS` is a pinned id list with a runtime-wide enum `minimal|low|medium|high` on `configSchema` — that enum is not per-model and MUST NOT become the picker.

Apply: when `codex` is on PATH, `listModels` runs `codex debug models --bundled` (no network refresh, no credential) and maps each catalog model's `supportedReasoningEfforts` onto `efforts` with `source: 'detected'`. On failure or missing binary, keep the current static ids with `efforts` omitted (unknown, free text) rather than applying the four-value enum to every row. Tests use a fake binary that prints a captured JSON fixture; do not spawn the real `codex` from a ticket (unlike OpenCode, this dump is a new spawn). Confirm the JSON field names against the first captured fixture during apply — the struct is 18 fields including `supportedReasoningEfforts`; do not invent the wire shape.

**Gemini — `[]` on every listed model.**
`buildArgs` does not pass `effort`. Adapter `configSchema` already says "Not supported by gemini 0.58; recorded for reporting only". 0.59's settings schema has `thinkingLevel: "HIGH"` (protobuf enum `LOW|HIGH`) inside `settings.json`, which this adapter does not write. Ticket non-goal: do not start passing it. Report `efforts: []` so the UI hides the control instead of offering a free-text box that cannot reach the CLI.

**Cursor — `[]` on every listed model.**
`configSchema` has no `effort`. `buildArgs` does not pass one. Thinking levels are distinct `--list-models` ids (`gpt-5.3-codex-high`, `claude-opus-5-thinking-high`, …). VS-200 explicitly declined constructing parameterized ids like `claude-opus-4-8[context=1m,effort=high]`. Report `efforts: []`. The model picker already is the thinking picker.

### UI lives in the shared Settings fields

`ModelSettingFields` gains the thinking-level control; `WorkerOptionsEditor`'s add form does too (today its `candidate` omits `effort`, so even a CLI-set option cannot be created from the web add form). `OverlaySetting` already wraps `ModelSettingFields` with `disabled={!filled}`, so inheriting daemon rows stay inert if the new control honors `disabled` the way VS-207 made the others honor it.

Picker `<select>` when `efforts` is non-empty, with an empty-string option "default (unset)". Hide the field when `efforts` is `[]`. Free-text `<input>` (committable on the saved setting, local state on the add form) when `efforts` is omitted or the model is custom. Changing model: if the stored effort is not in the new list, commit `{ ...setting, model, effort: undefined }`. Changing runtime already replaces the model list via `useRuntimeModels`; apply the same clear.

Do not add a third control on Chat, Onboarding, or the TUI unless they already reuse these components (Onboarding writes a `ModelSetting` without effort today — leave it; operators set thinking level on Models after).

`packages/ui/src/api/types.ts` `RuntimeModel` gains optional `efforts?: string[]`. `GET /runtimes/:id/models` needs no route change; `docs/API.md` documents the field.

### Tests assert flags as they are, and parse from real bytes

Do not rewrite `packages/runtimes/{claude,codex,opencode}/test/args.test.ts` except to keep them green. New tests:

- OpenCode `parseModels` against a captured `--verbose` fixture (id line, JSON with `variants`, empty `variants`, disabled variant skipped).
- Codex parser against a captured `debug models --bundled` fixture; fake binary for `listModels`.
- Claude `MODELS` entries that have catalog effort flags carry those values; one that does not support `xhigh`/`max` does not list them.
- Gemini and Cursor `listModels` items have `efforts: []`.
- UI: picker / hidden / free-text / optional unset / stale-effort-cleared / inheriting overlay inert, in `packages/ui/src/test/models.test.tsx`.

## Risks / Trade-offs

- **[Risk] OpenCode `--verbose` output is large (one JSON object per model).** → Parse incrementally (id line, then JSON until the next `provider/model` line). Timeout/maxBuffer already 60s / 8MiB on `listModels`; if a dump exceeds that, fall back to the id-only parse and omit `efforts` rather than failing the whole catalogue.
- **[Risk] Claude static efforts drift the same way VS-129's windows did.** → Pin them to the catalog in the installed CLI at apply time, document the version in the adapter comment, and keep `source: 'static'`. A later ticket can parse the binary at `listModels` time if drift returns; this ticket does not spawn `claude`.
- **[Risk] `codex debug models --bundled` flag spelling or JSON shape differs from clap ident `BUNDLED`.** → Confirm against a fake-CLI unit test whose argv and stdout are the contract; if the real flag is not `--bundled`, fix from `strings` of `--help` during apply without spawning against credentials. If bundled dump is unavailable, omit `efforts` on the static fallback rather than using the four-value enum.
- **[Risk] A stored free-text effort that is not in a newly detected list.** → Changing model clears it (spec). Opening the page with a stale effort on the current model: show it as the select value if present in the list, otherwise treat as custom free text so we do not silently drop a value the operator has not touched.
- **[Trade-off] Gemini/Cursor hide the control (`[]`) instead of free text (omit).** → A box that cannot reach the CLI looks like it works. Hiding matches "known to take none". Operators who still want to record an unused string can use `conductor models set --effort`.

## Migration Plan

No config or schema migration. Existing `effort` strings in `workspace.yaml` / `daemon.yaml` stay valid. After deploy, the web picker appears where the catalogue reports values; previously-set values keep launching as they do today.

Rollback is revert of the PR. Clients that ignore unknown `RuntimeModel` fields keep working.

## Open Questions

None. Adapter paths that could not enumerate values are recorded as `[]` or omitted above rather than left for apply to guess.
