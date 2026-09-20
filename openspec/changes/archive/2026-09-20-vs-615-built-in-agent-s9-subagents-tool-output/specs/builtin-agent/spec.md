## ADDED Requirements

### Requirement: A `task` tool runs a read-only explore subagent
The child SHALL offer a `task` tool with `description`, `prompt` and `agent` (only `explore`). It SHALL run a nested loop in the same process with a fresh history and only `read`, `grep` and `glob`, whatever the permission mode, and SHALL return the subagent's final text as the tool result. The subagent SHALL NOT be offered `task` (depth 1), bash, write tools, MCP tools or `todo_write`. It SHALL stop after a bounded number of steps and return what it has. Its token usage SHALL be added to the turn's usage. The tool SHALL be subject to `deniedTools` and `allowedTools` like any other, and SHALL be available in `restricted` because the subagent is read-only.

#### Scenario: Explore returns a summary
- **WHEN** the model calls `task` with an explore prompt and the subagent reads two files and answers
- **THEN** the parent's next request carries one tool result holding the answer and none of the subagent's intermediate messages

#### Scenario: The subagent cannot write or nest
- **WHEN** the subagent's model asks for `edit`, `bash` or `task`
- **THEN** it receives an unknown-tool result and nothing runs

#### Scenario: Cancel reaches the subagent
- **WHEN** the turn is cancelled while the subagent awaits its provider or a tool
- **THEN** the subagent stops, the `task` call gets a synthetic interrupted result, and the child exits as for any cancel

### Requirement: A subagent's events nest under its `task` call
Every event a subagent produces (`assistant.text`, `tool.call`, `tool.result`, `tool.denied`) SHALL carry `parentId`, the id of the `task` call, and its own ids SHALL be unique within the run. The transcript model SHALL render events carrying `parentId` as children of the tool block with that id, not as top-level blocks. An event whose parent is not in the run's events SHALL render top-level.

#### Scenario: Nested rendering
- **WHEN** a run holds a `task` call, three subagent tool calls with `parentId` set to it, and its result
- **THEN** the transcript has one tool block for `task` with three children, and no top-level blocks for them

### Requirement: `bash` streams its output while it runs
While a `bash` command runs, the child SHALL report its merged stdout and stderr as `tool_output` partials with `partId` `<call id>:out` and `toolCallId` set, coalesced at the child's existing partial interval. The completed `tool.result` SHALL carry `partId` `<call id>:out`, which supersedes the partials. The result text and its truncation rules are unchanged, and a command that produces no output produces no partial.

#### Scenario: Long command
- **WHEN** a command prints a line every second for five seconds
- **THEN** partials arrive while it runs, in order, and after `tool.result` the run holds no live partial for that call

### Requirement: Linked-worktree git metadata and the daemon config directory are protected from file tools
`confine.ts` SHALL refuse writes to the worktree's `.git` entry itself (the pointer file of a linked worktree) and to the gitdir it resolves to, in every mode, as it already does for `.git/hooks` and `.git/config`. When the host exposes the daemon config directory, file tools SHALL refuse writes under it.

#### Scenario: Pointer overwrite
- **WHEN** `write` targets `<worktree>/.git` in a linked worktree
- **THEN** it is refused with the protected-path message

### Requirement: Compaction and fork resolve the provider key in the session's workspace
`RuntimeAdapter.compactSession` and `forkSession` SHALL take an optional workspace id, the engine SHALL pass the session's workspace, and the weave adapter SHALL resolve the provider profile and key for that workspace.

#### Scenario: Two workspaces, one provider id
- **WHEN** two workspaces define provider `p` with different keys and a session of the second is compacted
- **THEN** the child receives the second workspace's key
