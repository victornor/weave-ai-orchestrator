## ADDED Requirements

### Requirement: `write` creates or overwrites a file atomically

The `write` tool SHALL accept `path` and `content`, write through a temporary file in the destination directory, flush it, rename it into place and preserve an existing file's mode, unlinking the temporary file if any step fails. It SHALL answer `Created <path> (N bytes)` for a new file and `Overwrote <path> (N bytes)` for an existing one, and SHALL emit a `file.changed` event carrying the path, the change type (`created` or `modified`) and the added and removed line counts. A file larger than 10 MB SHALL be refused with a message telling the model to use `bash`. Overwriting an existing file SHALL require a prior `read` of that path in the same turn.

#### Scenario: New file
- **WHEN** `write` targets a path that does not exist
- **THEN** the file exists with the given bytes and the result is `Created <path> (N bytes)`

#### Scenario: Atomic failure
- **WHEN** the rename step fails after the temporary file was written
- **THEN** the destination is unchanged and the temporary file is gone

#### Scenario: Refused without a prior read
- **WHEN** `write` overwrites a path the turn has not read
- **THEN** the result is an error naming the missing read and no bytes are written

### Requirement: `edit` replaces text through an ordered match chain with ambiguity as an error

The `edit` tool SHALL accept `path`, `old_string`, `new_string` and an optional `replace_all`, and SHALL find `old_string` by trying, in order: an exact match; a line-trimmed match; a whitespace-normalised match; an indentation-flexible match; and a smart-quote-normalised match. It SHALL apply a stage only when that stage yields exactly one match; more than one match without `replace_all` SHALL be an error naming the match count and telling the model to add context or set `replace_all`, and the tool SHALL NOT fall through to a fuzzier stage in that case. No match at any stage SHALL be an error saying the string was not found. `old_string` equal to `new_string` SHALL be an error. On success the tool SHALL answer `Edited <path>: N replacement(s)` followed by a unified diff hunk with three lines of context, SHALL emit a `file.changed` event carrying the path, change type `modified`, the added and removed counts and that diff, and SHALL refresh the read ledger so a following `edit` needs no re-read. CRLF line endings and a byte-order mark SHALL be detected and preserved across the edit.

#### Scenario: Ambiguous match
- **WHEN** `old_string` occurs three times without `replace_all`
- **THEN** the result is an error naming three matches and the file is unchanged

#### Scenario: CRLF and BOM preserved
- **WHEN** `edit` changes one line of a file whose lines end `\r\n` and that starts with a byte-order mark
- **THEN** the written file still starts with the byte-order mark and still uses `\r\n`

### Requirement: A read ledger detects a file that changed since it was read

The turn SHALL keep a ledger of every successful `read`, recording the resolved path, modification time, size and content hash. Before applying a `write` to an existing file or any `edit`, the tool SHALL stat and hash the file and SHALL refuse with `Error: file changed since it was read; read it again` when either differs from the ledger. A successful `write` or `edit` SHALL update the ledger entry to the new state. The ledger SHALL be per turn.

#### Scenario: Stale file
- **WHEN** a file is read, changed outside the tool, and then edited
- **THEN** the edit is refused with the stale-file error and the file is left alone

### Requirement: File tools are confined to the worktree and the agent home

A `path` SHALL be resolved against the worktree, then resolved through `realpath` so that a symlink is checked by its target, and then tested against the allowed roots: the worktree and the agent home. The check SHALL treat the worktree and the home as the only writable roots. Refused in every mode, including `bypass`, SHALL be: the worktree's `.git` internals (`hooks`, `config`), the agent home's daemon-rendered discovery files (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.opencode/`), and the workspace state directory reachable from the child's runtime configuration home (the directory holding `secrets.enc`, `secrets.key`, the daemon database and the runtime homes). Reads outside the roots SHALL be allowed only in `auto` and `bypass`, and only for system paths (`/usr`, `/etc/os-release`-class) and the run's tool-output spill directory; `restricted` SHALL allow no read outside the roots. A refusal SHALL be an ordinary error result beginning `Error:`.

#### Scenario: Symlink escape
- **WHEN** a file inside the worktree is a symlink whose target is outside every root
- **THEN** writing through the symlink path is refused

#### Scenario: Parent traversal
- **WHEN** `path` is `../../` relative to the worktree and resolves outside the roots
- **THEN** the tool refuses it

#### Scenario: Protected discovery file
- **WHEN** `write` targets the home's `AGENTS.md` in `bypass`
- **THEN** it is refused

#### Scenario: System read in restricted
- **WHEN** `read` targets `/usr/share/…` in `restricted`
- **THEN** it is refused, while the same read in `auto` is allowed

### Requirement: `grep` searches with `rg` when present and a built-in fallback otherwise

The `grep` tool SHALL accept `pattern`, and optional `path`, `glob`, `ignore_case`, `output_mode` (`content`, `files_with_matches`, `count`), `context` and `head_limit`. It SHALL use `rg` when it is on `PATH`, respecting ignore files and never searching `.git`, and SHALL otherwise walk the tree itself with a small `.gitignore` reader and JavaScript `RegExp`. `content` output SHALL be `path:line:text` rows, `files_with_matches` SHALL be one path per line in modification-time order, and `count` SHALL be `path:N`; output SHALL be capped at `head_limit` and carry a truncation note when it was applied. The child SHALL log once which implementation it is using.

#### Scenario: Both implementations agree
- **WHEN** the same pattern and directory are searched with `rg` available and with it hidden from `PATH`
- **THEN** both produce the same matching rows

### Requirement: `glob` lists matching paths by recency

The `glob` tool SHALL accept `pattern` and an optional `path`, SHALL return up to 100 matching paths ordered by modification time descending, and SHALL append a truncation note when more matched than were shown.

#### Scenario: More than the cap
- **WHEN** a pattern matches more than 100 files
- **THEN** the newest 100 are returned with a note that more matched

### Requirement: The three permission modes decide the tool set up front

`restricted` SHALL expose only `read`, `grep`, `glob` and the MCP tools, and SHALL remove the write-capable tools (`write`, `edit`, `bash`) from the request body itself so the model is never offered them. `auto` SHALL expose all six core tools plus the MCP tools, enforce the confinement rules and the bash deny patterns, and never ask for approval. `bypass` SHALL expose all tools, skip the bash deny patterns and skip root confinement for reads, while the protected-path list still applies to the file tools. A call the mode does not allow SHALL return `Denied by permission mode "<mode>"` and SHALL emit a `tool.denied` event rather than an unknown-tool error.

#### Scenario: Restricted request body
- **WHEN** a turn runs in `restricted` with MCP tools available
- **THEN** the recorded request body's tool list contains only `read`, `grep`, `glob` and the MCP tools

#### Scenario: Forced call in restricted
- **WHEN** the model calls `write` in a `restricted` turn
- **THEN** the result is `Denied by permission mode "restricted"` and a `tool.denied` event is emitted

### Requirement: `auto` refuses known-dangerous shell commands

In `auto`, `bash` SHALL refuse a command matching the deny patterns — `pkill`, `killall`, a `kill` fed by `pgrep`, `systemctl`, `weave|conductor daemon (start|stop|restart|upgrade)`, `sudo`, `gh auth login`, a push to a default branch, and `rm -rf` of `/`, `~` or `$HOME` — before the command runs, returning a refusal that names the rule, and SHALL emit `tool.denied`. The patterns SHALL be extended by a role's configured list. An ordinary command SHALL run as before.

#### Scenario: Denied patterns
- **WHEN** `bash` is called with `pkill -f x`, `systemctl restart y` or `weave daemon stop` in `auto`
- **THEN** each is refused, nothing is executed, and a `tool.denied` event is emitted

#### Scenario: Allowed command
- **WHEN** `bash` is called with `git status` in `auto`
- **THEN** it runs and returns the command's output

### Requirement: Tool allow and deny lists match the Claude aliases

`allowedTools` SHALL be exhaustive on an interactive first turn, and `deniedTools` SHALL always remove. Both SHALL match case-insensitively on the tool's own name and on its Claude alias, so `Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob` and `TodoWrite` select the same tools as their lower-case names.

#### Scenario: Alias in denied list
- **WHEN** `deniedTools` contains `Bash` and the model calls `bash`
- **THEN** the call is denied and `tool.denied` is emitted

#### Scenario: Alias in the allow list
- **WHEN** `allowedTools` contains `Edit` on the first interactive turn and the model calls `edit`
- **THEN** the call is allowed

### Requirement: The file and command events reach the transcript

`write` and `edit` SHALL emit `file.changed`; `bash` SHALL emit `command.executed` carrying the command, the exit code and the output; a permission refusal SHALL emit `tool.denied`. The `weave` adapter SHALL forward all three to the run's event sink unchanged. The run transcript SHALL render an `edit` as a file block with its diff and added/removed counts, and a `bash` call as a tool row whose target is the command.

#### Scenario: Edit renders as a diff
- **WHEN** a transcript is built from a weave `tool.call` for `edit` and its `file.changed` event
- **THEN** the blocks contain a file block whose diff carries the unified hunk and whose diff stat matches the counts

#### Scenario: Bash renders as a command
- **WHEN** a transcript is built from a weave `tool.call` for `bash`, its `tool.result` and its `command.executed` event
- **THEN** one tool row remains, its target is the command, and its status reflects the exit code
