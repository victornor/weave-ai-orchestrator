## 1. Group consecutive tool blocks

- [x] 1.1 Add a pure helper next to `runEventsToTranscript` that folds adjacent `type: 'tool'` blocks with the same `tool` name into groups of size ≥ 2, passes every other block through, and splits on a different name or a non-tool block. Unit-test: ten Reads → one group of 10; Read, Glob, Read → three groups; a single Read is not grouped; a text/phase line between two Reads keeps them apart.

## 2. Render counted rows in Transcript

- [x] 2.1 `Transcript` groups before applying the 150-block window. A group of N ≥ 2 renders as one `Name ×N` row (no target on the head); activating it lists each member with the existing per-call `TranscriptLine` (path/args/result as today); activating again restores the counted row. A singleton is unchanged (no `×1`). Verify in `packages/ui/src/test/transcript.test.tsx`: ten Reads show one `Read ×10` and expand to the ten paths; mixed Read/Glob/Read stays three groups; a single Read has no count.

## 3. Cover it

- [x] 3.1 Existing transcript, live-floor, and global-live tests still pass. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run` are green.
