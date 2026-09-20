## 1. Scaffolding

- [x] 1.1 Create `packages/agent` and `packages/runtimes/weave` (`package.json`, `tsconfig.json`, index files), register both in the root workspace and tsconfig references, and add their rules to `scripts/guard-boundaries.mjs`; `pnpm install`, `tsc -b` and `pnpm lint` pass.
- [x] 1.2 Add the minimal `providers` schema to `packages/shared/src/config.ts` (default `{}`) with a test that an existing workspace file still parses, and `weave: 'full'` in `RUNTIME_PARTIAL_OUTPUT`.

## 2. Agent library (`packages/agent`)

- [x] 2.1 `sse.ts`: byte-level SSE parser (streaming UTF-8, CRLF/LF/CR, `data:` with or without space, multi-line data, comments) with unit tests.
- [x] 2.2 `codec/chatCompletions.ts`: request builder (only set params, `max_tokens`, `stream_options`) and chunk reducer with the tool-call assembler and every quirk in the spec; fixtures reconstructed from the delta summaries recorded on VS-605 (the recorded lines were truncated, so they are not raw captures; see `packages/agent/fixtures/README.md`); the byte-split property test over every fixture.
- [x] 2.3 `testkit/mockProvider.ts`: loopback HTTP server serving `/v1/chat/completions` (SSE) from scenarios of raw fixture bytes or hand-written chunks, with `splitAt`, `dropAfterBytes`, `status`, `errorInStream`, `noDone`, `emptyChoicesUsage`, recording every request body.
- [x] 2.4 `session.ts`: linear JSONL append with flush, load with torn-line tolerance, projection to wire messages; tests including resume and torn line.
- [x] 2.5 `tools/{index,read,bash}.ts`: `ToolDefinition` registry, `read` and `bash` with their caps, footers, spill outside the worktree, process-group kill and the tool env that excludes the key and run token; temp-dir tests.
- [x] 2.6 `mcp/http.ts`: streamable-HTTP MCP client (`initialize`, `tools/list`, `tools/call`, JSON and SSE responses, `Mcp-Session-Id`, abort with `notifications/cancelled`); tests against a fake server.
- [x] 2.7 `protocol.ts`, `profile.ts`, `loop.ts`, `bin.ts`: init parsing, the loop with cancel at every await and synthetic interrupted results, partial and event emission, usage aggregation, minimal error classification, exit 143 on cancel; mock-provider loop tests including the cancel-injection table, resume asserted on the recorded request body, and absent-parameter assertions. Commit.

## 3. Adapter (`packages/runtimes/weave`)

- [x] 3.1 Additive `RuntimeAdapter.attach?(host)` and `RuntimeHost` in `runtime-sdk`, called from `registerBuiltins`, with the server implementation over workspace config and the secret store; `@weave-ai/runtime-weave` added to `RUNTIME_PACKAGES`.
- [x] 3.2 `adapter.ts`, `child.ts`, `events.ts`: capabilities, `detect`, `listModels` from config, `configSchema` with the four option keys, `installInstructions`, spawn with real pid via `onSpawn`, init line, NDJSON translation to events and `onPartial`, `cancel`, `send` unsupported, synthesised error result, session ref; adapter tests on recorded child NDJSON and a fake child script, including the pid, group kill, and key-absent-from-argv-and-env assertions and the partial-output declaration pin.

## 4. Live-check harness and docs

- [x] 4.1 `conformance.ts` and the `conformance` script: live one-shot report and raw SSE captures to a directory outside the repo; unit-tested against the mock provider only; the exact command to run is written in the PR description and a ticket comment.
- [x] 4.2 Update `builtin-agent-design`, `builtin-agent-runtime-details` and `builtin-agent-slices` where the captain's decisions differ (no cost display, weaver may use the runtime, `attach` in S1, permission modes only), then run `pnpm lint`, `pnpm typecheck` and one full `pnpm test` capped at `--maxWorkers=4`, and record both suite blocks verbatim.
