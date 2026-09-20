## Why

Weave AI runs every agent through a third-party coding CLI, so streaming, tool semantics, session format and error text are all decided by someone else, and no endpoint without such a CLI can be used. Captain decided (2026-09-20) to build our own small agent client that talks directly to any OpenAI-compatible Chat Completions endpoint. This is slice 1 of 9: a walking skeleton that proves one real streamed turn end to end — streaming, `weave_*` tools over the loopback MCP, cancel, resume — so later slices (edit tools, providers, resilience, context, live input) build on a working loop. The design is in the project knowledge documents `builtin-agent-design`, `builtin-agent-runtime-details` and `builtin-agent-slices` (section S1).

## What Changes

- New package `packages/agent` (`@weave-ai/agent`): a per-run child process with an NDJSON stdin/stdout protocol (v1), a byte-level SSE parser, a Chat Completions request and stream codec with a tolerant tool-call assembler, the agent loop with cancel at every await, `read` and `bash` tools with caps and spill, a linear session JSONL store, a streamable-HTTP MCP client, and a mock provider test kit.
- New package `packages/runtimes/weave` (`@weave-ai/runtime-weave`): the `weave` runtime adapter that spawns the child with the child's real pid, translates child output into `RuntimeEvent`s and `onPartial`, cancels, reports usage, and answers `send` with `unsupported`.
- `packages/shared`: a minimal `providers` schema in workspace config (`baseUrl`, `apiKeySecret`, `headers`, `auth`, `models`); `weave: 'full'` in `RUNTIME_PARTIAL_OUTPUT`.
- `packages/server/src/daemon.ts`: `@weave-ai/runtime-weave` in `RUNTIME_PACKAGES`. `scripts/guard-boundaries.mjs`: rules for the two new packages. Root workspace and tsconfig references.
- A live-check harness (`pnpm --filter @weave-ai/agent conformance --live`) prepared for the weaver to run against a real endpoint; nothing in this change touches a real provider or credential.
- Project knowledge design documents updated where the captain's 2026-09-20 decisions differ from them.

Non-goals (later slices): write/edit/grep/glob and permission modes beyond what `read`/`bash` need (S2), provider presets, discovery and the Settings UI (S3, S4), retry ladder and error table beyond the basics (S5), compaction, pruning and skills (S6), live input and structured output (S7), MCP stdio, web fetch and images (S8), subagents (S9). Also out: cost display and user-entered pricing, the Responses wire, OS sandbox, approval UI.

## Capabilities

### New Capabilities
- `builtin-agent`: the `weave` runtime — the child protocol, the Chat Completions streaming codec, the loop with cancel and valid history, the `read` and `bash` tools, session persistence and resume, the run-scoped MCP client, secret handling, and the adapter's events, partials, pid and usage.

### Modified Capabilities

None.

## Impact

- New packages `packages/agent` and `packages/runtimes/weave`; edits in `packages/shared/src/{config,events}.ts`, `packages/server/src/daemon.ts`, `scripts/guard-boundaries.mjs`, root `package.json`/`tsconfig.json`/`pnpm-workspace`.
- No database migration, no API route, no UI change. The runtime is selectable only where a workspace configures a provider and a model `weave`/`providerId/modelId`; existing runtimes are unchanged.
- Dependency added: none expected beyond `js-tiktoken` (already in the repo) for usage estimation when a provider reports none.
