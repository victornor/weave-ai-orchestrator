## Context

See `proposal.md` — Why. Two adapters throw away a name their own already-parsed discovery
output carries; the UI then hides even the labels that do exist. Codex, Claude and Gemini were
checked and need no change (see proposal — What Changes).

## Goals / Non-Goals

**Goals:**
- Use a name a runtime's existing discovery output already reports, wherever the adapter already
  parses one, instead of discarding it.
- Show a human both the name and the id in the picker, so the id that lands in config is never
  hidden.

**Non-Goals:**
- Changing `RuntimeModel`'s shape, `listModels()`'s signature, or any config/storage format.
- A second CLI invocation, a cache read, or a registry fetch anywhere, for any runtime.
- Touching codex, claude, or gemini — their labels already come from a real name (codex's
  `display_name`) or a hand-maintained static catalogue with real names (claude, gemini).

## Decisions

### Cursor: use the CLI's own `<displayName>`, not the humanizer, when the line has one

`cursor-agent --list-models` prints `<id> - <displayName>[ (current, default)]` per model
(established by VS-200's static analysis of the installed CLI bundle, recorded in that ticket's
design.md). The current `parseListModelsOutput` keeps only the text before `" - "` as the id and
throws the rest away, then `toModel(id, 'detected')` re-derives a label from the id alone via a
hand-rolled family/variant humanizer (`humanize()`). That humanizer was written for VS-200 to
avoid a *hand-maintained id→label table* going stale — it was not written with the knowledge that
the CLI's own output already carries a real display name on the same line; VS-200's design.md
never discusses using it. Using the reported name instead is strictly better on that same
staleness concern: it needs no maintenance at all, and it is the runtime's own name rather than a
guess (the existing fixture line `gpt-5.2 - GPT-5.2` already demonstrates the mismatch: the
humanizer would produce "GPT 5.2", not the CLI's own "GPT-5.2").

`toModel()` gains an optional label-override parameter; `parseListModelsOutput` passes the parsed
`<displayName>` when the line has one, omitting it (falling through to `humanize()`) for a bare
id line. `deriveLabel()`/`humanize()` are otherwise untouched — they still back the static
fallback list and any bare-id line, exactly as before.

**Alternative considered**: keep the humanizer for everything and additionally show the raw
`<displayName>` text somewhere else. Rejected — the humanizer exists only to approximate the name
the CLI already gives us directly; once that name is available there is nothing for the
approximation to add.

### Opencode: read the same `name` field the effort parser already opens

`parseModels` already locates and `JSON.parse`s the per-model object (to read `variants` for
`efforts`, VS-228). That parsed object also has a `name` field (confirmed in the recorded
`models-verbose.txt` fixture, including the exact `deepseek-flash` → "DeepSeek V4.1 Flash" shape
from the ticket). Reading `obj.name` alongside `obj.variants` is a one-line addition to work
already being done — no new parse pass, no new fixture needed since the real bytes already
contain this shape.

### One new shared formatter for the picker, not four copies

`packages/ui/src/lib/runtime.ts` already holds small `RuntimeInfo`/`RuntimeModel`-adjacent display
helpers (`runtimeStatusLabel`). A sibling `modelOptionLabel(model)` returning `` `${label} (${id})`
`` when `label !== id`, else `id`, is added there and imported by all four `<select>` call sites
(`Onboarding.tsx`, and three in `Settings.tsx`) instead of four separate inline template strings —
matching the file's existing pattern for this kind of formatting decision.

## Risks / Trade-offs

- [Risk] A future `cursor-agent` version changes the `<id> - <displayName>` text format →
  Mitigation: the parser already isolates this in one function with its own unit tests; a format
  change fails those tests loudly rather than silently mislabelling, same residual risk VS-200
  already accepted for the id-parsing half of this same line.
- [Risk] Widening the picker's rendered text could crowd a narrow `<select>` → Mitigation: only
  add the id when it differs from the label; a model with no better name renders exactly as
  today (id alone).
