## Why

The built-in `weave` agent (S1, S3, S5) runs a turn and resumes a linear session, but a session only grows: nothing compacts it, old tool output is never pruned, the system prompt has no skills or nested instructions, and cached-token usage is read but never used to steer the request. Captain decided on 2026-09-20 that the weaver may use this runtime as well as workers, so the long-session behaviour must hold at weaver scale: hundreds of messages and about 40 `weave_*` tool schemas that cost thousands of tokens on every request.

## What Changes

- **Sessions become trees.** Session entries keep `id`/`parentId`; a new `compaction` entry (summary, `firstKeptEntryId`, tokens before/after, accumulated file lists) is written to the JSONL, and the model-visible history is the path from the leaf, summary first. Old linear files load unchanged.
- **Compaction.** A proactive trigger before each request (`estimate > window − max(16384, maxOutput)`), an overflow-reactive path (a `context_overflow` 400 compacts and retries once), and a `--compact` child mode so the adapter's `compactSession` can compact out of band. The cut keeps the newest ~20k tokens on a turn boundary and never separates an assistant tool-call message from its results. The summary is an iterative structured summary from the same model; a failed summary leaves the session untouched.
- **Pruning at projection time** (never in the session file): above 70 % of the window, tool results older than the newest 40k tokens become `[output pruned; …]` when that saves at least 20k.
- **Token accounting** with js-tiktoken and a 1.15 margin, replaced by the provider's own `prompt_tokens` once a request has been made. The tool-schema JSON is counted in the window budget.
- **Instructions and skills.** Lazy nested `AGENTS.md` appended to a `read`/`edit` result once per directory (32 KiB cap); a skill index in the system prompt and a `skill` tool. The system prompt is at most 1200 tokens excluding AGENTS.md and is byte-stable across requests.
- **Caching.** New compat flags `promptCache` (`none` | `key` | `anthropic`) and `cachedTokensField`; `prompt_cache_key` and `cache_control` markers are sent only where the profile says so; cached tokens reach `TurnResult.usage.firstRequest`.
- **Adapter.** `compactSession`, `forkSession` (copies the session file), a real `describeSession`, `modelContextWindow` already exists and now feeds the child, capability `forkSessions: true`, and `contextCompactionAt` is declared. A retention sweep removes session files unused for 30 days (option `sessionRetentionDays`). An unknown window disables proactive compaction with one warning.
- **Weaver scale is tested**: a 500+ message history with the weaver's full tool set compacts, resumes and continues without losing the last human message, and a weaver-kind turn calling `weave_human_send` works end to end over the loopback MCP.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `builtin-agent`: adds session tree and compaction, pruning, token accounting, instructions and skills, prompt caching, retention, and the weaver-scale requirements.

## Impact

`packages/agent/src/{session,compaction,prune,tokens,instructions,skills,cache,loop,bin,protocol}.ts`, `codec/{params,chatCompletions}.ts`, `packages/agent/presets/*.json` (`promptCache`), `packages/shared/src/config.ts` (compat fields), `packages/runtimes/weave/src/{adapter,child,events}.ts`, tests in both packages, and the design docs in the knowledge base (`builtin-agent-runtime-details` sections 7 and 8, `builtin-agent-slices`). No engine change: it already consumes `session.compaction.started/completed`, `compactSession` and `modelContextWindow`.

## Non-goals

A second, cheaper summariser model; embeddings; deferred tool search; cost display; any live provider call. The runtime stays permission-modes-only with no OS sandbox.
