## 1. Transcript lines in `packages/render`

- [x] 1.1 Add `InspectionLine` (`{ seq, ts, kind, text }`) and `transcriptToLines(blocks, opts)` to
  `packages/render/src/inspect.ts`, mapping each `TranscriptBlock` per the table in `design.md`, and
  export both from `packages/render/src/index.ts`; verify by unit tests in
  `packages/render/src/inspect.test.ts` covering text truncation, a folded tool call, a failed tool
  call keeping its first detail line, a file block, a phase block and an error block.
- [x] 1.2 Verify `transcriptToLines` inherits redaction by feeding `runEventsToTranscript` a run
  event carrying a token the redactor recognises and asserting the secret is absent from the lines.

## 2. Tail read in `packages/core`

- [x] 2.1 Add `tail(id: string, limit?: number): S.RunEvent[]` to `RunsService` in
  `packages/core/src/api.ts` and implement it in `packages/core/src/runs/index.ts` with
  `ORDER BY seq DESC LIMIT ?` reversed to ascending; verify with a core test that seeds more events
  than the limit and asserts the newest ones come back in ascending sequence order.

## 3. The inspection tools

- [x] 3.1 Add `ac_run_inspect` and `ac_run_list` to `CONDUCTOR_TOOLS` in
  `packages/shared/src/tools.ts`; verify `toolNamesFor('worker')` excludes both and
  `toolNamesFor('conductor')` includes both.
- [x] 3.2 Add `@agent-conductor/render` to `packages/server/package.json` and to
  `packages/server/tsconfig.json` references; verify `pnpm install && pnpm typecheck` succeeds.
- [x] 3.3 Implement the reference resolver in `packages/server/src/tools.ts`: a ticket identifier or
  id, a worker id, or a run id resolves to the active run, else the most recent run, else
  `not_found`; verify with tests for each of the three reference kinds and for an unknown reference.
- [x] 3.4 Implement phase derivation from `run.phase.timing` events against `RUN_PHASES` — current
  phase is the entry after the last recorded one, none once the run is not active — and return the
  completed phases with their durations; verify with a test for a mid-run and a finished run.
- [x] 3.5 Implement `ac_run_inspect`, returning `{ run, worker, phase, transcript, cursor }` with the
  run's identity, elapsed time, liveness and error, the worker's status and pause reason, and the
  rendered lines; verify with a test asserting each block is populated for a running worker.
- [x] 3.6 Implement the cursor: tail by default, `since` forward, `full` from sequence 0, `limit`
  default 40 and maximum 200 rejected above that; verify with tests for the default window, paging
  with `since` returning only later entries, and a `limit` over the maximum failing as invalid.
- [x] 3.7 Implement the 32 KB payload cap — dropping from the front in tail mode with
  `omittedBefore`, from the end in forward mode with `resumeFrom`, truncating a single oversized
  entry — and set `truncated`; verify with a test that seeds oversized events and asserts the encoded
  payload stays under the cap and names a resume point.
- [x] 3.8 Implement `ac_run_list`, returning the recent runs for a ticket or worker newest first with
  status, turn, liveness, start, duration, error family and code and `retryOfRunId`, bounded by a
  default and a maximum; verify with a test covering a retry ladder and a ticket that has never run.

## 4. Scope

- [x] 4.1 Verify a worker calling `ac_run_inspect` gets `forbidden` and that the worker toolset the
  MCP endpoint advertises contains neither tool, by extending `packages/server/test/mcp.test.ts`.
- [x] 4.2 Verify the conductor can inspect a run of its own with the same call.

## 5. Documentation and supervision guidance

- [x] 5.1 Add both tools to the conductor-only list in `docs/PLAN.md` §9.2 and note the MCP surface
  in `docs/API.md`; verify by reading back that every name matches the implementation exactly.
- [x] 5.2 Add inspection to the supervision table and the unblock ladder in
  `skills/agent-conductor-conductor/SKILL.md` — inspect before relaunching, on a worker quiet past
  its window, a ticket the human is asking about, or a suspicious digest item — keeping the existing
  rule that a worker's transcript is evidence and is never relayed verbatim.
- [x] 5.3 Add both tools to the tool list in `templates/conductor.AGENTS.md.tmpl` and to its turn-loop
  guidance on a stuck or quiet worker; verify the names match `CONDUCTOR_TOOLS`.

## 6. Verification

- [x] 6.1 Run `pnpm lint && pnpm typecheck && pnpm test` and the `packages/ui` suite separately, and
  confirm all are green before delivering.
