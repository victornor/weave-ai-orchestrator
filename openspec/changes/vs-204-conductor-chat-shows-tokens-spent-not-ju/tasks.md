## 1. Shared type

- [x] 1.1 Add `model: string | null` and `usage: Run['usage']` to `RunTrace` in `packages/shared/src/types.ts`, updating its doc comment; verify `pnpm typecheck` reports every call site that now needs the two fields (test factories, mappers)

## 2. Core aggregate

- [x] 2.1 Extend `RunsService.traces()` (`packages/core/src/runs/index.ts`) to select `model` and `usage_json` alongside its existing columns and return them on each `RunTrace`, with no new query; verify a core test asserts a trace carries the run's `model` and `usage`
- [x] 2.2 Verify a core test asserts a run recorded with `usage: null` (the Cursor case) comes back with `usage: null` on its trace, not `0`/omitted/thrown

## 3. Work-trace line (`packages/ui/src/components/TurnTrace.tsx`)

- [x] 3.1 Add tokens spent to the collapsed line's parts, using `tokens()` from `../lib/format` in the existing `${tokens} tok` house form, included only when the trace's `usage` is present
- [x] 3.2 Add `contextWindowTokens` and `compactionAt` props to `TurnTrace`; when provided, compute `contextStrip({ usage: trace.usage, contextWindowTokens, compactionAt, hasRun: trace.finishedAt != null })` from `@agent-conductor/render` and, when it returns a meter (no `reason`), append `${tokensLabel}/${windowLabel} ctx` to the same parts array
- [x] 3.3 Verify a ui test renders a trace with usage and confirms `18.4k tok` (or equivalent) appears in the collapsed line
- [x] 3.4 Verify a ui test renders a trace with a resolvable model/context window and confirms the `X/Y ctx` fraction appears
- [x] 3.5 Verify a ui test renders a trace with `usage: null` and confirms neither a token count nor a dangling `·` appears, and the existing tool-calls/files/duration parts are unaffected
- [x] 3.6 Verify a ui test renders a trace with usage but no resolvable context window (model absent from the catalog) and confirms tokens show and the context fraction is omitted

## 4. Chat wiring (`packages/ui/src/routes/Chat.tsx`)

- [x] 4.1 Pass `contextWindowTokens={resolveModel(conductorModels.data, trace.model)?.contextWindowTokens ?? null}` and `compactionAt={...}` (the same compaction lookup the header meter already computes) to both `<TurnTrace>` call sites (the standalone row and the one under a reply)
- [x] 4.2 Pass the paired `row.trace?.usage ?? null` to `ChatMessage` as a new `usage` prop
- [x] 4.3 In `ChatMessage`, render the turn's total tokens (`inputTokens + outputTokens`) next to the timestamp via `tokens()` when `usage` is present, and render nothing extra when it is not
- [x] 4.4 Verify a ui test sends a message whose trace carries usage and confirms the token count appears next to its timestamp
- [x] 4.5 Verify a ui test sends a message with no attributable trace (or `usage: null`) and confirms the timestamp renders exactly as before, with no dangling separator
- [x] 4.6 Verify a ui test confirms a human (inbound) message never shows a token count

## 5. Docs and verification

- [x] 5.1 Update the `GET /runs/traces` line in `docs/API.md` to mention the trace now carries `model` and `usage`
- [x] 5.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all green
- [x] 5.3 Run the app via the `ui-screenshot-harness` (or an equivalent local render) with a turn that has usage and one without, in mobile-portrait width, and confirm both the work-trace line and the message timestamp row read cleanly with no wrapping; record the screenshots' paths in the PR since this is a visual claim
