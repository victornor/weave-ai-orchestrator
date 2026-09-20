## 1. Sessions and compaction (half a)

- [x] 1.1 `session.ts`: `compaction` entry, `context()` projection, fork copy helper, tolerant loading of linear files; unit tests
- [x] 1.2 `tokens.ts`: estimator with margin, request estimate using provider counts plus tool-schema tokens; tests including a 40-schema set
- [x] 1.3 `compaction.ts`: cut selection on turn boundaries (keeps newest user message), summariser request and template, accumulated file lists; property test over random histories
- [x] 1.4 Loop wiring: proactive trigger, reactive path on `context_overflow` (once), unknown-window warning, `session.compaction.*` events; mock-provider integration incl. mock 400 overflow and resume-starts-with-summary
- [x] 1.5 `--compact` child mode in `bin.ts` and protocol; adapter `compactSession`, `forkSession`, `describeSession`, `forkSessions` and `contextCompactionAt`; adapter tests on the fake agent

## 2. Pruning, instructions, skills, caching (half b)

- [x] 2.1 `prune.ts` projection pruning (70 % / 40k / 20k) with tests that the session file is untouched and the prefix is stable below threshold
- [x] 2.2 `instructions.ts` lazy nested `AGENTS.md` and `skills.ts` index plus `skill` tool; tests
- [x] 2.3 System prompt budget and byte-stability assertions (≤ 1200 tokens, identical system message across requests)
- [x] 2.4 `cache.ts` and compat fields `promptCache` / `cachedTokensField` in shared config and codec; `prompt_cache_key` and `anthropic` request-body tests; cached tokens flow to `usage.firstRequest`
- [x] 2.5 Retention sweep with `sessionRetentionDays` option and config schema entry; test with aged temp files

## 3. Weaver scale and docs

- [x] 3.1 Weaver-scale tests: 500+ message history with about 40 `weave_*` schemas compacts, resumes, keeps the last human message; a `weave_human_send` turn end to end through the mock loopback MCP
- [x] 3.2 Update `builtin-agent-runtime-details` sections 7 and 8 and `builtin-agent-slices` in the knowledge base to match what was built; run lint, typecheck and one full suite with `--maxWorkers=4`
