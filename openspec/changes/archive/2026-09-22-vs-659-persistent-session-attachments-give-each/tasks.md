## 1. Declare the image-input capability

- [x] 1.1 Add an optional `imageInput?: 'native' | 'path' | 'model'` to `RuntimeCapabilities` in `packages/runtime-sdk/src/index.ts`, with a doc comment explaining the three forms and that omitted means `path`; include it in `FakeRuntime`'s `capabilities`. Verify with `pnpm typecheck` and a `@weave-ai/runtime-sdk` test asserting the default and a declared value.
- [x] 1.2 Declare it on all six built-in adapters — claude `native`, weave `model`, codex/opencode/gemini/cursor `path` — and update each adapter's capability assertion. Verify with each adapter's test (`pnpm vitest run packages/runtimes`).

## 2. Resolve the form once and carry it on the run

- [x] 2.1 Add a core resolver `imageAttachmentForm(ctx, runtimeId, model): 'native' | 'path'` that reads the adapter's declared capability and, for `model`, the effective provider profile's `compat.image.input`. Verify with unit tests: `native`; `model` with image declared; `model` with `none`; undeclared/`path`.
- [x] 2.2 Extend `RunTokenClaims` with optional `imageInput` and `attachmentDir`, and mint both in `executeRun` from the resolved form and the agent home. Verify with a run-token round-trip test (`signRunToken`/`verifyRunToken`) and an engine test reading the minted claims.
- [x] 2.3 Add the resolved form and the attachment paths to `TurnPromptOptions`, and make the attachment line in `buildTurnPrompt` form-aware: unchanged for `native`, naming the absolute readable paths for `path`. Verify with prompt tests for both forms.

## 3. Materialise readable paths and report them

- [x] 3.1 For a `path`-form run, materialise each image attachment on the run's wakes under `<agent.homePath>/.weave-attachments/<runId>/`, prune sibling run directories, and add `.weave-attachments/` to the ticketless session home's `.gitignore`. Verify with a core test asserting the file exists, is inside the home, is not inside a worker worktree and not inside the daemon state directory, and its absolute path is named in the prompt.
- [x] 3.2 Make `weave_inbox` report the attachment's `path` (and no MCP `image` block) for image attachments when the run's form is `path`, and keep returning the `image` block for `native`. Verify with a server `tools.ts` test covering both forms.
- [x] 3.3 Confirm a text document attachment is still delivered as its literal content in both forms. Verify with a server test asserting the inlined text in a `native` and a `path` run.

## 4. Probe and record the per-runtime form

- [x] 4.1 Probe claude, codex, opencode and the built-in weave runtime read-only — installed binary strings and the adapter's own code, never launching a CLI (per ADR 0015 and the credential rule) — and record the per-runtime evidence and declared form. Verify: the evidence table is in the PR body.
- [x] 4.2 Add one test per runtime adapter for the attachment form it gets: each adapter's declared capability, and for a `path` form that the run's delivery is a named readable path rather than an image block; plus one test for a runtime that cannot take images (declaration omitted resolves to `path`). Verify the tests pass.

## 5. Verify and deliver

- [x] 5.1 Iterate on changed test files, then run one full suite with `--maxWorkers=4`; paste both suite blocks verbatim in the PR. Verify both blocks are green and reported without summing them.
- [x] 5.2 State in the PR body, per runtime, what an image attachment gets, and that no UI change is made (so no captures are needed). Verify the PR body carries the list.