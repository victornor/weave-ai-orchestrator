## Why

A persistent session can now be sent an attachment (VS-657 put the composer in place), but delivery is
runtime-neutral: every runtime is handed the image as an MCP `image` content block through
`weave_inbox`. Only Claude is known to render that block as vision input (ADR 0015); the built-in
`weave` runtime drops it for a model whose provider profile turns image input off, and Codex and
OpenCode have never been established to render it at all. On those runtimes the attachment is
silently dropped. This change makes the delivered form match what each runtime can actually take.

## What Changes

- A runtime declares a new **image-input capability** (`capabilities.imageInput`): `native` when an
  MCP `image` content block reaches the model, `model` when that depends on the run's provider
  profile, and `path` otherwise (the safe default for a runtime that declares nothing). The six
  built-in adapters declare it: **claude** `native`, **weave** `model`, **codex**, **opencode**,
  **gemini** and **cursor** `path`.
- For a runtime whose form is `path`, the daemon **writes each image attachment's bytes to a file
  inside the agent's own home** (never the worktree, never the daemon state directory), **names the
  absolute path in the turn's prompt**, and has `weave_inbox` return that same path in the
  attachment's entry **instead of an `image` content block**. The attachment is then something the
  agent can read, rather than something silently dropped.
- Text documents keep arriving as inline content on every runtime — they are already runtime-neutral.
- The form is **decided once per turn** by the run engine and carried on the run token, so the
  prompt and `weave_inbox` cannot disagree about it.
- **Probe** claude, codex, opencode and the built-in `weave` runtime for where an image input actually
  lands, read-only (installed binary strings / the adapter's own code, never launching a CLI), and
  record the per-runtime result in the PR body.
- Add capability `runtime-image-input`; update `persistent-sessions`.

**Not changed:** the composer, paste/attach wiring, storage, caps and the display on the human's
message (those are VS-657). Ticketed workers' and the weaver's interrupt/dictation behaviour is
untouched; the delivery mechanism here is runtime-level, so it applies wherever an attachment is
delivered, but no worker/weaver contract changes.

## Capabilities

### New Capabilities

- `runtime-image-input`: what the image-input capability means, how a run's form is resolved (including
  the model-dependent built-in runtime), and the readable-path fallback that guarantees an image
  attachment is never silently dropped.

### Modified Capabilities

- `persistent-sessions`: the existing requirement "A session's attachment reaches the agent" changes
  from "an image's bytes as image content" to "in the form the session's runtime can take" — native
  image content where the runtime takes one, otherwise a named readable path.

## Impact

- **runtime-sdk**: `RuntimeCapabilities` gains the optional `imageInput` field.
- **runtimes**: claude, codex, opencode, weave, gemini and cursor declare it (`path` is the default,
  so an external plugin runtime that declares nothing keeps the safe form).
- **core**: a resolver for the per-run form; the engine materialises image attachments for `path`-form
  runs under the agent home and names them in the turn prompt; the run token carries the resolved form
  and the attachment directory.
- **server**: `weave_inbox` returns the readable path (instead of `image` content) for a `path`-form
  run.
- **specs**: `runtime-image-input` (new), `persistent-sessions` (modified).
- No database migration, no config change, no UI change.