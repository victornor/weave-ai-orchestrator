## 1. Confinement and ledger

- [x] 1.1 Add `packages/agent/src/tools/confine.ts`: resolve a path against the worktree, `realpath` it, accept only the worktree and the agent home as roots, refuse the protected set (worktree `.git/hooks` and `.git/config`, the home's `AGENTS.md`/`CLAUDE.md`/`.claude`/`.agents`/`.opencode`, and the workspace state directory derived from the runtime configuration home), allow system-path and spill-directory reads only in `auto`/`bypass`, and name the daemon-config-directory gap in a comment. Carry `configHome` on the child's `init` line (`protocol.ts`, `child.ts`). Verify: a temp-dir confinement table test covering symlink escape, `..`, a protected write, a home discovery file and a `/usr` read in every mode passes; `pnpm --filter @weave-ai/agent test` green.
- [x] 1.2 Add `packages/agent/src/tools/ledger.ts` (per-turn map of resolved path → `{mtimeMs, size, sha1}`) and make `read` record into it. Verify: temp-dir tests show a stale file is refused with `file changed since it was read; read it again` after an outside write, and a successful write refreshes the entry.

## 2. Write and edit

- [x] 2.1 Add `packages/agent/src/tools/write.ts` with the schema and output shapes from runtime-details section 5: temporary file in the destination directory, flush, rename, mode preserved, temp unlinked on failure, 10 MB refusal, prior-read requirement, and a `file.changed` emission with change type and line counts. Verify: temp-dir tests for create/overwrite byte equality, an injected rename failure leaving the destination unchanged and no temp file, the 10 MB refusal, and the prior-read refusal.
- [x] 2.2 Add `packages/agent/src/tools/edit.ts`: the five-stage match chain with ambiguity terminal and exactly-one application, `replace_all`, `old_string == new_string` refusal, CRLF and BOM preservation, the `Edited <path>: N replacement(s)` result with a ±3-line unified diff hunk, a `file.changed` emission carrying that diff, atomic write and ledger refresh. Verify: temp-dir tests for each stage, the three-match ambiguity error leaving the file unchanged, `replace_all`, the CRLF+BOM round trip, and the stale-file refusal.
- [x] 2.3 Register `write` and `edit` in the loop's core tools for `auto` and `bypass` only. Verify: a mock-provider turn calling `edit` records `tool.call` before execution and `file.changed` after it (loop test).

## 3. Search

- [x] 3.1 Add `packages/agent/src/tools/grep.ts` with `pattern`, `path`, `glob`, `ignore_case`, `output_mode`, `context` and `head_limit`, using `rg` when present (ignore files respected, `.git` excluded) and the built-in walker with a `.gitignore` reader and JS `RegExp` otherwise, logging once which is in use. Verify: a temp-dir parity test runs the same queries with `rg` on `PATH` and with it hidden and asserts identical `content`, `files_with_matches` and `count` rows.
- [x] 3.2 Add `packages/agent/src/tools/glob.ts`: up to 100 paths, modification time descending, truncation note when more matched, same `rg`-or-walker split. Verify: a temp-dir test with more than 100 matches returns the newest 100 plus the note, and the fallback agrees.

## 4. Permissions

- [x] 4.1 Add `packages/agent/src/permission.ts` with the mode → tool-set table, the Claude-alias map (`Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `TodoWrite`) and a single `check` used by the loop. Verify: a permission table test asserts the `restricted` request body's tool list is exactly `read`, `grep`, `glob` and the MCP tools, and an alias table test shows an allow/deny entry written for Claude selects the lower-case tool.
- [x] 4.2 Add the `auto` bash deny patterns as named regexes (the design's list), extendable by a role's configured list, and the refusal text naming the rule. Verify: the pattern table test refuses `pkill -f x`, `systemctl restart y` and `weave daemon stop`, allows `git status`, and a configured extra pattern is refused.
- [x] 4.3 Wire the loop's full-tool and active-tool maps: a call to a tool the mode removed returns `Denied by permission mode "<mode>"` and emits `tool.denied`; a name in neither map keeps the existing unknown-tool error. Verify: a loop test asserts the denial text, the `tool.denied` event, the absence of a following `tool.result` row for the same call, and the `auto` deny-pattern refusals.

## 5. Events and adapter mapping

- [x] 5.1 Give `ToolCtx` `emit`, `ledger` and the resolved roots; move `command.executed` out of the loop's special case into `bash`, and emit `file.changed` from `write`/`edit`. Verify: a mock-provider loop test asserts the order `tool.call`, then the tool's own event, then `tool.result`, for both a `bash` and an `edit` turn.
- [x] 5.2 Add an adapter test asserting `file.changed`, `command.executed` and `tool.denied` from recorded child NDJSON reach the sink unchanged. Verify: `pnpm --filter @weave-ai/runtime-weave test` green.

## 6. Render golden and screenshots

- [x] 6.1 Record the child NDJSON for an `edit` turn and a `bash` turn from the mock-provider loop test, then write the render golden in `packages/render/src/transcript.test.ts` from those real bytes, asserting the `edit` file block carries the unified hunk and the `+N −M` stat and that the `bash` call folds into one tool row whose target is the command. Verify: `pnpm --filter @weave-ai/render test` green, and the payloads match the captured file byte for byte.
- [x] 6.2 Render the run page's transcript for the captured `edit`+`bash` turn with the static harness ([[ui-screenshot-harness]]), dark and light at desktop and phone width, save the four images outside `work/`, and attach them to the ticket with `weave_ticket_attachment_put`. Verify: four attachments on VS-608 and the paths unchanged after the last commit.

## 7. Docs and final verification

- [x] 7.1 Update `builtin-agent-runtime-details` (section 5/6) and `builtin-agent-slices` (S2 section and its Decisions) where this slice's implementation differs, including the daemon-config-directory gap. Verify: the knowledge documents read accurately against the merged code.
- [x] 7.2 Run `pnpm lint` and `pnpm typecheck`, then one full `pnpm test --maxWorkers=4` at the end and paste both suite blocks verbatim on the ticket and in the PR. Verify: both suites green and no untracked files in `work/` (`git status --porcelain` empty).