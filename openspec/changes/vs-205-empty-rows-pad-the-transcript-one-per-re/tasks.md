## 1. Shared render package (`packages/render/src/transcript.ts`)

- [x] 1.1 Fold `command.executed` into the tool row its `tool.call`/`tool.result` pair already
      rendered (via call id, matched against open or already-completed calls), back-filling detail,
      duration and error status only where the row is missing them; never add a second row for a
      matched call.
- [x] 1.2 When no matching call is in view, render `command.executed` standalone under the tool name
      the payload carries (not a hardcoded `'shell'`), and only when it carries a command or output.
- [x] 1.3 Give an orphaned, name-unresolved `tool.result`/`tool.denied` a preview of its result body
      as its target instead of a bare fallback name.
- [x] 1.4 Tests: the real recorded Claude `Bash`/`echo pong` triple (`tool.call` + `tool.result` +
      `command.executed`, values taken from `packages/runtimes/claude/test/events.test.ts`'s
      pinned assertions against `packages/runtimes/claude/fixtures/turn-tool-structured.jsonl`)
      renders as one row; a `command.executed` backfilling a missing result; the existing orphan
      `command.executed` test still passes unchanged.

## 2. Web app's own builder (`packages/ui/src/lib/transcript.ts`)

- [x] 2.1 Same fold/backfill/standalone-only-with-content treatment for `command.executed`, so the
      live view and the conductor chat's work trace (both consume this builder) stop showing the
      bare `$` row.
- [x] 2.2 Same result-body-preview treatment for an orphaned `tool.result`/`tool.denied`.
- [x] 2.3 Tests: the same real recorded Claude triple renders as one row with no bare `$`; an orphan
      `command.executed` with neither command nor output is dropped; one that carries either still
      renders.

## 3. Verify

- [x] 3.1 `pnpm lint && pnpm typecheck && pnpm test` green (both vitest configs).
- [x] 3.2 Confirm no runtime adapter (`packages/runtimes/*`) was touched — this stays a rendering/
      ingestion-only change per ticket scope.
