## Purpose
An interactive terminal client for Weave AI's built-in agent, so a person can run it, test a model, inspect its skills and MCP servers and resume sessions from a shell, without a daemon, a workspace or a ticket.

## ADDED Requirements

### Requirement: The REPL is installed with the CLI and runs the existing loop
`weave repl` and a `weave-agent` command SHALL start an interactive session on the built-in agent's loop, with the same tools, permission modes, compaction, skills, MCP client and steering queue a daemon turn has. The `weave-agent` command SHALL be written next to `weave` by every path that writes the `weave` shim, so it is on PATH after an upgrade. `--help` SHALL work from the installed path.

#### Scenario: A prompt is answered
- **WHEN** a prompt is entered against a provider that streams text and then a tool call
- **THEN** the streamed text and a compact rendering of the tool call and its result appear, and a session file exists afterwards

#### Scenario: Installed shim
- **WHEN** `writeCliShims` runs for a release that has a CLI build
- **THEN** both `weave` and `weave-agent` shims exist, executable, and `weave-agent --help` prints the REPL's usage

### Requirement: Standalone operation and configuration sources
The REPL SHALL run with no daemon and no workspace. Provider profiles SHALL come from, in order, `--provider`/`--base-url` flags, the nearest workspace's `providers`, then the user's `agent.yaml`. A provider key SHALL come from `WEAVE_LLM_<PROVIDER>_KEY`, else the workspace secret store read locally, else a hidden in-memory prompt. A key SHALL NOT be written to disk, appear in argv, output, logs, `--debug` output, session files or the bash tool's environment.

#### Scenario: Environment key, scratch home
- **WHEN** the REPL runs with a scratch `HOME`, no workspace and `WEAVE_LLM_<PROVIDER>_KEY` set, and completes a turn
- **THEN** the request carries the key, and the key appears in no argv, terminal output or session file

#### Scenario: Workspace provider
- **WHEN** a workspace with a provider and a stored secret resolves from the working directory
- **THEN** that provider and key are used without contacting the daemon

### Requirement: One-shot and resume modes
`-p "<prompt>"` SHALL run one turn, print the final text to stdout and exit with the loop's exit code. `-c` SHALL resume the most recent human session for the current directory and `--resume <id>` a named one, for both `-p` and the interactive mode.

#### Scenario: Exit code
- **WHEN** `-p` runs a turn that fails with an authentication error
- **THEN** stdout carries no final text, the error is on stderr, and the exit code is the loop's non-zero code

#### Scenario: Continue
- **WHEN** `-c -p "again"` runs in a directory with an earlier session
- **THEN** the next request body contains the earlier messages

### Requirement: Slash commands
The REPL SHALL provide `/help /sessions /new /compact /skills /mcp /model /permissions /exit`, tab-completable, with `/help` listing them and an unknown command refused with a hint.

#### Scenario: Sessions
- **WHEN** `/sessions` runs in a directory with sessions from two directories
- **THEN** only this directory's sessions are listed (id, age, first user line, model, message count); `/sessions --all` lists both; choosing one by number or id resumes it and the next request contains its messages

#### Scenario: Skills and MCP
- **WHEN** `/skills` runs with a project skill and a user skill, and `/mcp` runs with one working stdio server and one failing server
- **THEN** each skill is listed with its source, the working server shows connected with its tool count, and the failing one shows failed with its reason; `/mcp <server>` lists that server's tools

#### Scenario: Model and parameters
- **WHEN** `/model <id>` and `/model effort high` run, then a prompt is sent
- **THEN** the request body carries the new model and the reasoning parameter the provider's compat maps `high` to, and a parameter never set is absent from the body

#### Scenario: Invalid parameter
- **WHEN** `/model temperature 9` runs
- **THEN** the value is refused with the parameter schema's message and the previous value stays in force

#### Scenario: Permission mode
- **WHEN** the REPL starts without `--permission`
- **THEN** the mode is `auto`, `/permissions` shows it, and `/permissions restricted` removes the write and shell tools from the next request

### Requirement: Cancel, exit and steering
Ctrl-C during a turn SHALL cancel it and leave a loadable session; at an idle prompt a second Ctrl-C SHALL exit, and Ctrl-D on an empty line SHALL exit. Text entered while a turn runs SHALL be delivered to the running turn through the steering queue.

#### Scenario: Interrupt
- **WHEN** Ctrl-C is sent while a tool call is running
- **THEN** the turn ends interrupted, the session file loads, and the next prompt continues from it

#### Scenario: Steering
- **WHEN** a line is typed while a turn is waiting on a tool result
- **THEN** the next request in that turn contains it as a user message

### Requirement: Human sessions are separate from worker sessions
The REPL SHALL store its sessions in its own directory in the agent's existing JSONL format, marked as REPL sessions, subject to the same 30-day retention, and SHALL list and resume only from that directory.

#### Scenario: Worker session not listed
- **WHEN** a worker's session file exists under a workspace's runtime directory
- **THEN** it does not appear in `/sessions --all` and cannot be resumed by id
