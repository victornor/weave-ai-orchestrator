# Running the agent yourself

Weave AI's built-in agent (runtime `weave`) can be run by hand in a terminal, without the daemon, a workspace or a ticket. It is the same loop, tools, compaction, skills and MCP client a worker turn uses, in a plain prompt-and-scrollback interface (no full-screen UI).

```
weave repl                          # interactive
weave-agent                         # the same command
weave repl -p "explain src/main.ts" # one turn: final text on stdout, exit code from the turn
weave repl -c                       # continue the newest session started in this directory
weave repl --resume 3f9a            # resume by id, id prefix, or number
```

`weave-agent` is a second command written next to `weave` (`~/.local/bin/weave-agent`) by every path that writes the `weave` shim, so it is on your PATH after `weave daemon upgrade`. The command is `repl`, not `agent`: `weave agent` is the run-token group agents use inside a run, and `weave chat` talks to the conductor.

## Providers, keys and where each thing is read from

Lowest to highest precedence:

| What | Source |
|---|---|
| Provider profiles and MCP servers | `~/.config/weave/agent.yaml` (`providers:`, `mcpServers:`, plus `provider:`, `model:`, `permission:` defaults; `$XDG_CONFIG_HOME` is honoured) |
| … | the nearest `workspace.yaml` at or above the current directory (`providers:`, `mcpServers:`); `--workspace-dir <dir>` names one. The files are read directly: the daemon is never contacted, and does not need to be running |
| … | `--provider <id> --base-url <url> [--preset <name>] [--model <id>]` builds a profile in memory |
| Provider key | `WEAVE_LLM_<PROVIDER>_KEY` in the environment (provider id upper-cased, `-` becomes `_`; a profile's `apiKeySecret` name is tried first), else the workspace's encrypted secret store (`secrets.enc` / `secrets.key`), read locally, else, on a terminal, a hidden prompt whose answer is kept in memory only |
| MCP `${NAME}` references | the environment, then the workspace secret store |

A provider given only with `--base-url` and no key in the environment is called without authentication (fine for a local Ollama or LM Studio); a provider from a config file needs its key, and `-p` exits 2 saying which variable to set.

A key is never written to disk, never in argv, never printed (the renderer masks it), never in a session file, and never in the environment of the `bash` tool (which gets only `PATH`, `HOME`, `LANG`, `TMPDIR`, `USER`, `TERM`). Shell history is kept in `<agent home>/history` (mode 0600) and holds only what you typed at the prompt, never the hidden key prompt.

## Sessions

Your sessions are in their own directory, `<agent home>/sessions/<id>.jsonl`, where the agent home is `$WEAVE_AGENT_HOME`, else `$XDG_DATA_HOME/weave-agent`, else `~/.local/share/weave-agent`. The format is the agent's own JSONL session; a REPL file's header line carries `"origin":"repl"`, and one `{"type":"repl"}` bookkeeping line per turn records the model and your first prompt. A worker's ticket sessions live under a workspace's runtime directory, a tree the REPL never reads, so `/sessions` cannot list or resume one. Sessions unused for 30 days are removed (the agent's usual retention).

## Commands

Tab completes them. `/help` lists them.

| Command | What it does |
|---|---|
| `/sessions [--all] [n\|id]` | your sessions in this directory (`--all`: everywhere): id, age, model, message count, first prompt. A number or id resumes it |
| `/new` | a fresh session |
| `/compact` | summarise the older conversation now |
| `/skills` | skills for this directory and where each came from: project `./.agents/skills`, user `~/.agents/skills`, user `~/.config/weave/skills` (project wins a name clash) |
| `/mcp [server]` | each configured server: connected with its tool count, or failed with the reason; `/mcp <server>` lists its tools |
| `/model` | provider, model, effort and the parameters that are set |
| `/model list` | the profile's models merged with what the endpoint reports (`GET {baseUrl}/models`) |
| `/model <id\|n\|provider/id>` | switch model |
| `/model effort high`, `/model temperature 0.2`, `topP`, `maxOutputTokens`, `contextWindowTokens`, `frequencyPenalty`, `presencePenalty`, `seed` | set a parameter; an out-of-range value is refused with the parameter schema's message and nothing changes. `/model unset <param>` clears one. A parameter that is not set is never sent; `effort` is sent as the provider's compat maps it |
| `/permissions [auto\|restricted\|bypass]` | show or set the mode |
| `/exit` | leave |

A change applies from the next request and lasts for the session. Nothing is saved back to a config file.

## While a turn runs

Streamed text prints as it arrives, thinking is dimmed, a tool call is one line (`▸ bash  make test`), an `edit` shows its diff, and `bash` shows its output as it streams. **Ctrl-C** cancels the turn (the session stays loadable; work done so far is kept); at an idle prompt a second Ctrl-C exits, and **Ctrl-D** exits. Type a line while a turn runs to steer it: it is delivered at the next request boundary (`↳ queued: …`). No cost is displayed.

## Permission mode

The default is **`auto`**: every core tool and MCP server, file tools confined to the current directory and the agent home, shell commands checked against the deny patterns (`pkill`, `systemctl`, `sudo`, …), and no approval prompts, the same posture a worker has. `restricted` is read-only (read, search, skills, MCP servers marked `readOnly: true`); `bypass` drops the shell-command guard and the read confinement, so choose it deliberately (`/permissions bypass` or `--permission bypass`). The agent runs in your process with your account's rights: this is hygiene, not a sandbox.

## Not verified here

Every automated check runs against the mock provider; a real turn from a real terminal on a real endpoint has to be run by a person (`weave repl -p "say hi" --provider … --base-url …`).
