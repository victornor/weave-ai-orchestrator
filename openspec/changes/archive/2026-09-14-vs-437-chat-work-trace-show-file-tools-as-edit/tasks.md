# Tasks

- [x] 1. `packages/ui/src/lib/transcript.ts`: add the raw path to a tool block (`targetPath: string | null`) where the target came from `file_path`/`filePath`/`path`/`notebook_path`, and a pure exported `targetBaseName(path)` (`/a/b/c.ts` → `c.ts`, trailing `/` dropped, `\` separators handled, bare name unchanged, empty falls back to the input). Leave `target` as it is.
- [x] 2. `packages/ui/src/components/Transcript.tsx`: render `targetBaseName(block.targetPath)` when set, else `block.target`, and put the full path in the target span's `title`.
- [x] 3. `packages/ui/src/v2/ChatTrace.tsx`: the same display in `ToolRow`, keeping VS-433's streaming behaviour (reveal the label).
- [x] 4. Tests: `packages/ui/src/test/transcript.test.tsx` (unit-test `targetBaseName`; an absolute-path Edit/Read/Write renders its base name with the full path in `title`; a Bash command is unchanged) and `packages/ui/src/test/v2chattrace.test.tsx` (the V2 row does the same).
- [x] 5. Evidence and checks: a real-browser capture of the V2 chat trace in dark and light with an Edit, a Read and a Bash row; `pnpm lint`, `pnpm typecheck` and both suites pass with their output pasted verbatim.
