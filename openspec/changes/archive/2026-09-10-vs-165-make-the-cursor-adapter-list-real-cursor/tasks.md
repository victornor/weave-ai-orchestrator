## 1. Catalog

- [x] 1.1 Replace `MODELS` in `packages/runtimes/cursor/src/adapter.ts` with the documented live catalog (`auto`, Grok 4.6, Opus 5, 5.6, Fable 5.1, plus `--model` help examples `gpt-5` and `sonnet-4-thinking`). Pin `--model` slugs from a spawn-free bundle pass; drop stale `composer-2-5`. `source: 'static'`. Verify `listModels` returns those ids, every entry is `source: 'static'`, and the adapter test does not spawn `cursor-agent`.

## 2. Launch: Auto and argv prompt

- [x] 2.1 Change `buildArgs` so `--model` is omitted when the model is unset, empty, or `auto` (case-insensitive), and forwarded otherwise. Ignore `options.liveInput`: always put a fitting prompt after `--`, or closed plain-text stdin when oversized. Never write an NDJSON `user` frame as the print-mode prompt. Verify with `test/args.test.ts`: `auto`/unset have no `--model`; a named id is `--model <id>`; default spawn has `-- <prompt>` and null stdin; oversized uses closed stdin; no `--worktree`/`acp`/`worker`; no `&` prefix.

- [x] 2.2 Set `streamingInput: false`. `runTurn` uses `stdinMode: 'close'` and omits `send`. Rewrite `test/fakeCli.ts` so the fake `cursor-agent` completes from an argv prompt (or closed stdin), not a JSON user frame. Rewrite `test/liveInput.test.ts` (or replace it) so a fake-CLI turn with `model: 'auto'` and a turn with a named catalog id both finish `exitCode === 0`, and the handle has no `send`. Never spawn the real CLI.

## 3. Docs and verify

- [x] 3.1 Update `docs/PLAN.md` §8.3 Cursor row: print-mode prompt is argv (or closed stdin), `streamingInput` is false, attach queues. Do not tell the reader to invoke `agent`.

- [x] 3.2 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` at the repo root. PR states: catalog slugs not confirmed with live `--list-models`; live stdin on cursor is intentionally not claimed; Cloud Agent handoff and `--worktree` remain test-guarded.
