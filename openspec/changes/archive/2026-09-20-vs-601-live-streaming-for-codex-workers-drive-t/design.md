## Context

VS-595 (merged, `openspec/specs/live-run-progress`) gave the engine an ephemeral partial channel: adapters call `sink.onPartial({kind, partId, text, toolCallId?})`, the engine coalesces and redacts, the page drops a partial when the completed event with the same `partId` arrives. opencode is wired through a per-turn `opencode serve` with `run --format json` as fallback (`packages/runtimes/opencode/src/serve.ts`). This change does the same for Codex. See proposal.md for motivation.

Today `packages/runtimes/codex/src/adapter.ts` spawns `codex exec --json … -` (args from `args.ts`, parser in `events.ts`) and `compact.ts` already speaks the app-server JSON-RPC protocol for compaction.

## Goals / Non-Goals

**Goals:** text, reasoning, command output and tool start/progress visible as generated; keep permission postures, resume, fork, cancel, usage, error classification and startup-failure reasons; automatic per-turn fallback.
**Non-Goals:** no change to what is persisted; no UI redesign (the page already renders `partialOutput: 'full'`); no interactive approvals from a human; no switch of `compactSession`; no change to other runtimes.

## 1. Diagnosis (measured, no credentials)

**Method.** Real `codex-cli 0.154.0` `app-server` against a local mock OpenAI Responses server and a scratch `CODEX_HOME` (`-c model_provider=mock`, dummy key). The mock returns a `shell` function call whose command prints `line1..3` one second apart, then streams `"All three lines printed."` in four deltas 300 ms apart. No live login, no real model. The protocol schema comes from `codex app-server generate-json-schema` (also with a scratch home). Offsets are ms from process spawn; the mock produced its function call at ≈+600 ms after the request and its text deltas at 300 ms spacing.

What `exec --json` shows for this turn: `item.started`/`item.completed` per item only (the existing parser emits `tool.call` only for `mcp_tool_call` and `runtime.raw` for started items; a command execution appears once, complete, at the end of its 3 s). A page has nothing for those 3 s but "working".

What the app-server sends (recorded, in order):

| ms | frame |
|---|---|
| 160 | `initialize` result, then `initialized` |
| 176 | `thread/start` result `{thread:{id}}` and `thread/started` |
| 180–190 | `turn/start` result `{turn:{id,status:"inProgress"}}`, `turn/started` |
| 206 | `item/started` and `item/completed` `userMessage` |
| 985 | `item/started` `commandExecution` (`command`, `cwd`, status `inProgress`) — visible at start |
| 1853, 2853 | `item/commandExecution/outputDelta` `{itemId, delta:"line2\n"}` … one per output chunk while the command runs |
| 3856 | `item/completed` `commandExecution` |
| 3858 | `thread/tokenUsage/updated` `{tokenUsage:{total,last}}` |
| 3869 | `item/started` `agentMessage` |
| 4170–5073 | `item/agentMessage/delta` `{itemId,delta}` at the mock's 300 ms cadence, each within a few ms of production |
| 5074 | `item/completed` `agentMessage` (full text) |
| 5077 | `thread/status/changed` idle, `turn/completed` (`turn.status`, `turn.items`) |

Conclusions: tool start is visible ≈3 s earlier than under `exec`; text deltas arrive at model cadence; usage arrives per model request. The daemon and page hops are as measured in VS-595 (≪10 ms). Task 5 repeats the end-to-end measurement (delta produced → visible on the page) before and after on the same mock and states it as mock-based, since a real provider is forbidden here. Recordings live in `packages/runtimes/codex/test/fixtures/app-server-*.jsonl` (task 1.1), written from these real bytes; the translator's patterns come from them, not from the schema alone.

Not seen in the recording (no approval was requested because the sandboxed command ran inside the workspace): the exact approval request frames. Their shapes come from the generated schema (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `mcpServer/elicitation/request`; decisions `accept | acceptForSession | decline | cancel`, elicitation actions `accept | decline | cancel`) and task 1.2 records one real request by asking for a command outside the sandbox on the mock.

## 2. Decision — how a Codex turn is driven

| | A. `codex app-server` per turn (chosen) | B. keep `codex exec --json` | C. `exec --json` plus tail the rollout file |
|---|---|---|---|
| partial text / reasoning / command output | yes (`item/*/delta`, `outputDelta`) | no | no: rollout holds completed items |
| tool running state | yes (`item/started`) | started items carry no arguments for commands; only MCP calls get `tool.call` | same as B |
| approvals | server requests the adapter must answer by mode (below) | headless, no requests | same as B |
| sandbox, model, effort, MCP | `thread/start` params plus the same `-c` overrides on the `app-server` command (`-c` is accepted by `app-server`) | flags and `-c` | same |
| resume / fork | `thread/resume`, `thread/fork` by thread id | `exec resume`/`exec fork` | same |
| cancel | `turn/interrupt`, then terminate the process | kill process | same |
| usage | `thread/tokenUsage/updated` (`total`, `last`), same baseline logic as today | `turn.completed.usage` | same |
| errors | `error` notification (`willRetry`), `turn/completed` status `failed` with `error`, process exit + stderr | `turn.failed`, stderr, VS-526 | same |
| lifecycle | adapter owns a stdio process for the turn; needs a handshake | one process | one process plus a file watcher on a path Codex does not document |

**Choice: A, with B as the automatic per-turn fallback**, exactly the shape of VS-595: the engine only sees `onEvent` and `onPartial`, so the driver is replaceable and the risk is bounded to "no partials", not "no turn". C was rejected: the rollout carries no deltas and its format is not a contract. Long-lived shared app-server (one daemon-wide process) was rejected: it would couple every worker's containment, env, `CODEX_HOME` and MCP token to one process; per-turn keeps the existing per-run isolation and the VS-579 memory scope.

**Driver sequence.** Spawn `codex app-server -c …` through `spawnLines` with `stdinMode: 'open'` and the turn's containment and timeout (as `exec` today). Send `initialize` (`clientInfo`) → `initialized`. New: `thread/start {cwd, model, sandbox, approvalPolicy, config?}`; resume: `thread/resume {threadId, …}`; fork: `thread/fork`. Then `turn/start {threadId, input:[{type:'text',text}], effort, outputSchema?}`. The prompt goes in JSON, not argv or stdin text, so nothing leaks into `ps`. Instructions (`AGENTS.md`) are files in the worktree exactly as for `exec`; nothing changes.

**Permission postures (reproduce `exec`, do not widen):**
- `bypass`: `approvalPolicy: never`, sandbox `danger-full-access` (= `--dangerously-bypass-approvals-and-sandbox`). No requests arrive.
- `restricted`: sandbox `read-only`, policy `never` (as `exec` runs it, so nothing is asked); any request that still arrives is answered `decline`.
- `auto`: sandbox `workspace-write`, policy `on-request` (today's `-c approval_policy=on-request`). Command, file-change and permission escalation requests are answered `decline`; `mcpServer/elicitation/request` for the run-scoped `weave` server is answered `accept`, others `decline`. The MCP server also keeps `default_tools_approval_mode="approve"` via the same `-c` overrides, so normal Weave tool calls never reach the elicitation path.
- Any unrecognised server request gets an error response, never silence (a silent request hangs the turn).
Open point for the owner: what a headless `exec` does today with an escalation in `auto` mode is not verifiable without the real CLI; the plan treats it as declined (the conservative reading) and a test asserts the decline. If the owner knows it auto-accepts, that is a one-line change to the mode table.

**Fallback boundary.** Before `turn/start` is accepted: spawn error, no `initialize` answer in 10 s, an error on `thread/start`/`resume`/`fork`, or a nonzero exit → the adapter runs `exec` unchanged (VS-526's stderr reasons, `--skip-git-repo-check` and all). After `turn/start` succeeded there is no fallback, so a prompt is never sent twice; a cut-off is a failed turn with the stderr reason, decided as an `exec` early exit is. `--skip-git-repo-check` has no app-server flag; whether `thread/start` demands a trusted directory is verified in task 1.3 against a non-git scratch cwd, and if it does, that case falls to `exec`.

**Translation (`app-server-events.ts`, a second producer of the same `RuntimeEvent`s):**
- `item/started`: `commandExecution` → `tool.call {id, name:'command', input:{command,cwd}}`; `fileChange` → `tool.call` (paths); `mcpToolCall` → `tool.call {id, server, name, input}` (same shape as today); `reasoning`, `agentMessage` → opens a partial part.
- `item/agentMessage/delta`, `item/reasoning/textDelta` (and `summaryTextDelta`), `item/commandExecution/outputDelta`, `item/fileChange/outputDelta`, `item/mcpToolCall/progress` → `onPartial` with `partId` = item id (`tool_input` for tool output and progress, `toolCallId` = item id).
- `item/completed` → the events the current parser produces (`assistant.text`, `assistant.thinking`, `command.executed`, `file.changed`, `tool.result`, `plan.proposed`), reusing the parser's item mapping (extracted so both producers share it) so persisted output is identical, with `id` equal to the partial's `partId`. The command test-summary parse (VS-328) stays.
- `thread/tokenUsage/updated` → cumulative usage as today's `turn.completed.usage`; `usage.delta` on `turn/completed` with the same baseline subtraction; `contextTokens` from `last`.
- `error` (`willRetry: true` is a retry, not a failure), `turn/completed` `failed`/`interrupted` → `error` + `turn.completed {failed:true}`; `turn/completed` `completed` → `turn.completed`.
- Everything else → `runtime.raw` with `originalType`, as the parser does, but never `warning`/`rateLimits`/`thread/status` noise per frame: those are dropped to keep the events table compact.
- Final text and structured output: the last `agentMessage` item text (replaces `-o last-message.txt`); `outputSchema` goes in `turn/start`.

**Write rate.** Partial frames are ephemeral (VS-595); persisted events per turn equal today's, plus `tool.call` at start for commands and file changes (one extra row per such item). No delta is stored.

## Recorded findings (apply phase)

- `thread/start` works in a non-git cwd with no trust prompt: no `--skip-git-repo-check` equivalent is needed (`app-server-stream.jsonl`).
- `item/commandExecution/requestApproval` carries `availableDecisions` (`accept`, an execpolicy amendment, `cancel`), yet `decline` is accepted and the item completes `status: "declined"` (`app-server-escalate.jsonl`).
- `thread/resume` on a thread the app-server itself created replays that thread's earlier `thread/tokenUsage/updated` before the `turn/start` result; the translator ignores notifications until it knows its own turn id. Resuming a thread created by `codex exec` was not recorded (no such thread on the mock); the fallback covers a rejected resume.
- No reasoning deltas were recorded: the mock provider emits none. `item/reasoning/*` translation follows the schema only and is covered by nothing recorded.

## Risks / Trade-offs

- The app-server is marked experimental (`[experimental] Run the app server`). Protocol drift is contained by: pinned recordings, tolerant parsing (unknown frames become `runtime.raw`), and the automatic `exec` fallback. A drift that breaks translation after `turn/start` is the one uncovered case; a CI check of recordings against the installed schema is not attempted (it would need the binary in CI).
- Approval semantics in `auto` are inferred (see above); mitigated by declining, never accepting, escalations.
- Real-provider latency is unmeasured (forbidden); the before/after numbers are mock-based and labelled so. The owner can repeat with a real run.
- One extra process handshake (~150 ms measured: initialize answered at +160 ms) per turn.
- Stuck detection (`last_progress_at`) is unchanged: only persisted progress events count.

## Migration

None. `options.appServer: false` (documented in the adapter's config schema) opts a role or run out; default on.
