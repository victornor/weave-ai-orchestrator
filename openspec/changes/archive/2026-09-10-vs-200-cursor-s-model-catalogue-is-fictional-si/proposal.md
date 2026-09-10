## Why

`MODELS` in `packages/runtimes/cursor/src/adapter.ts` is a hand-typed list of seven ids. Six are
invented — `grok-4-6`, `opus-5`, `composer-5-6`, `fable-5-1`, `gpt-5` and `sonnet-4-thinking` are
not accepted by `cursor-agent`, which rejects every one of them on spawn. Only `auto` works. The
two most obviously "real-looking" invented ids (`gpt-5`, `sonnet-4-thinking`) turn out to be the
CLI's own `--help` illustrative examples for `--model`, not real ids — the catalogue was assembled
from documentation prose, never from the CLI's own list. `cursor-agent --list-models` ("List
available models and exit") already exists as a first-class way to ask the CLI what it accepts, so
the fix is to ask it, cache the answer, and degrade to a corrected static list when asking fails —
not to hand-maintain a second guess that will drift the same way.

## What Changes

- `listModels()` calls `cursor-agent --list-models`, parses its output into `RuntimeModel[]`
  (`source: 'detected'`), and caches a successful result in-process for a bounded time so a model
  picker rendering repeatedly does not respawn the CLI on every render.
- On any failure to detect (binary missing, non-zero exit, timeout, unparseable output) or before
  the first successful detection, `listModels()` returns a corrected static fallback list built
  from the real ids captured in this ticket's rejection message (`source: 'static'`) — never an
  empty list, never a throw.
- `auto` is always present in the returned list, whichever path answered.
- Ids get an algorithmically derived human-readable label (family word + variant suffix) instead of
  a hand-typed label table, so a new id the CLI starts offering still reads as something recognizable
  rather than a raw id or nothing.
- A turn rejected with `cursor-agent`'s "Cannot use this model: X. Available models: ..." message
  (including the UI-truncated form ending `, ...`) has that list parsed and folded into the
  `TurnResult.error.message`, so a human sees the live-rejected catalogue directly instead of just
  the id that failed.
- No change to the `RuntimeAdapter.listModels()` signature, the `GET /runtimes/:id/models` route, or
  any client of it — the shape returned is unchanged (`RuntimeModel[]`), only its contents and
  provenance.

## Capabilities

### Modified Capabilities

- `cursor-runtime/adapter`: "Models are listed without spending tokens" changes from a purely
  static list to a cached, CLI-sourced list with a static-list fallback; `auto`-presence and label
  derivation are now explicit requirements; the existing `--model` forwarding and model-mismatch
  requirements are unchanged.

## Impact

- `packages/runtimes/cursor/src/adapter.ts` — `listModels()`, and the `runTurn` error path for
  unknown-model rejections.
- New `packages/runtimes/cursor/src/models.ts` (parsing, labelling, fallback catalogue, cache).
- `packages/runtimes/cursor/test/fakeCli.ts` and its tests — a `--list-models`-aware fake CLI mode.
- No changes to `packages/runtime-sdk`, `packages/core`, `packages/server`, or `packages/ui`: the
  adapter contract, the daemon route, and every client of `GET /runtimes/:id/models` are unaffected.
