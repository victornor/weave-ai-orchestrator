# Running the agent yourself

Weave AI's built-in agent (runtime `weave`) can be run by hand in a terminal, without the daemon, a workspace or a ticket. It is the same loop, tools, compaction, skills and MCP client a worker turn uses, in a plain prompt-and-scrollback interface (no full-screen UI).

```
weave repl                          # interactive
weave-agent                         # the same command
weave repl -p "explain src/main.ts" # one turn: final text on stdout, exit code from the turn
weave repl -c                       # continue the newest session started in this directory
weave repl --resume 3f9a            # resume by id, id prefix, or number
weave repl --context-window 128000  # the model's context window, when the endpoint does not report one
```

`--context-window <tokens>` sets the run's `contextWindowTokens` for the session, which is what the agent compacts against; without it (and with no window on the model or provider) it logs once that the context window is unknown.

`weave-agent` is a second command written next to `weave` (`~/.local/bin/weave-agent`) by every path that writes the `weave` shim, so it is on your PATH after `weave daemon upgrade`. The command is `repl`, not `agent`: `weave agent` is the run-token group agents use inside a run, and `weave chat` talks to the conductor.

## A minimal config, from any directory

The REPL needs nothing but a provider. Put one in your own config file — `~/.config/weave/agent.yaml` (`$XDG_CONFIG_HOME` is honoured) — and `weave repl` and `weave-agent` work **from any directory**: no daemon, no workspace, no project.

```yaml
provider: openai
model: gpt-4o-mini
providers:
  openai:
    baseUrl: https://api.openai.com/v1
    apiKey: "sk-..."     # a literal key; or "${OPENAI_API_KEY}" / "{env:OPENAI_API_KEY}" to read one from the environment
    models:
      gpt-4o-mini:
        contextWindow: 128000
```

A literal `apiKey` is honoured **only** in this user file. In a workspace's `workspace.yaml` it is refused with a one-line message, because a workspace directory may be committed or shared — use `apiKeySecret` or the environment there. The key is never printed, never in argv, never in the `bash` tool's environment, never in a session file, `debugWire` output or an error message. If `agent.yaml` is readable by group or others and holds a plaintext credential, the REPL prints one line naming the file's mode with `chmod 600 <file>`, and still runs.

## One place for the daemon; MCP servers, and only they, per workspace

Providers for the built-in agent are configured **once, at the daemon level** (Settings → daemon scope → Providers, or `providers:` in `daemon.yaml`), so every workspace sees them and a worker option that names one (Settings → Models, runtime `weave`, model `<provider>/<model>`) works anywhere with nothing configured per workspace. Providers are **daemon-only**: a `providers:` block in a `workspace.yaml` (and a `disabledProviders:` list) is ignored, there is no per-workspace provider override and no workspace Providers page. MCP servers are configured at the daemon level too and **may be overridden per workspace**: an entry with the same name replaces the daemon's for that workspace only, whole, and `disabledMcpServers` hides an inherited one; a workspace with neither sees the daemon's set unchanged. Provider keys and MCP `${SECRET}` values entered at the daemon level live in the daemon's own encrypted store beside `daemon.yaml`; for an MCP `${SECRET}` a workspace secret of the same name wins. `weave repl` reads the same `daemon.yaml` directly, so a provider you configured for the daemon works in the terminal too (it ignores a workspace `providers:` block; its workspace `mcpServers:` layer still applies). On the Providers page you give a provider its models: add an entry by hand, or **Fetch from endpoint** to list `GET {baseUrl}/models` and pick from the ids (the fetch uses the profile as edited, so it works before you save, and a key you have typed but not yet saved). **Test connection** takes a model selected from those entries or typed in, so a provider whose endpoint the daemon never queried for discovery can still be checked; with no model configured and none typed the action is disabled and says so.

## Providers, keys and where each thing is read from

Lowest to highest precedence:

| What | Source |
|---|---|
| Provider profiles and MCP servers | the daemon's `daemon.yaml` (`providers:`, `mcpServers:`) in its config directory (`$AC_CONFIG_HOME`, else `$XDG_CONFIG_HOME` or `~/.config`, under `weave`, or `agent-conductor` on a host installed before the rename). This is where providers are configured **once** for the daemon and every workspace (Settings, daemon scope); providers are daemon-only. Read directly from the file, so the daemon need not be running. A literal `apiKey` is refused here too |
| … | `~/.config/weave/agent.yaml` (`providers:`, `mcpServers:`, plus `provider:`, `model:`, `permission:` defaults; `$XDG_CONFIG_HOME` is honoured) |
| … | the nearest `workspace.yaml` at or above the current directory, for **MCP servers only** (`mcpServers:`, and `disabledMcpServers:` to hide a daemon server — a `providers:`/`disabledProviders:` block there is ignored, VS-654); `--workspace-dir <dir>` names one. An MCP server or `agent.yaml` entry with the same name replaces a lower one **whole** (no field-level merge). The files are read directly: the daemon is never contacted, and does not need to be running |
| … | `--provider <id> --base-url <url> [--preset <name>] [--model <id>]` builds a profile in memory |
| Provider key | first hit wins: the profile's own `apiKey` (a literal or a `${NAME}`/`{env:NAME}` reference; user `agent.yaml` only), then `WEAVE_LLM_<PROVIDER>_KEY` / the `apiKeySecret` name in the environment (provider id upper-cased, `-` becomes `_`), then the daemon's (`daemon-secrets.enc` / `daemon-secrets.key` in its config directory), each read locally, else, on a terminal, a hidden prompt whose answer is kept in memory only. There is no `--api-key` flag (it would land in argv); a workspace secret store does not contribute a provider key (VS-654) |
| MCP `${NAME}` references | the environment, then the workspace secret store, then the daemon's |

A provider given only with `--base-url` and no key in the environment is called without authentication (fine for a local Ollama or LM Studio); a provider from a config file needs its key, and `-p` exits 2 saying which variable to set. When a provider in a config file is skipped because it does not validate, the message names the file and the failing field (for example `apiKeySecret` must be a secret name such as `WEAVE_LLM_<PROVIDER>_KEY`, not the key itself) and never echoes the field's value.

A key is never written to disk by the REPL, never in argv, never printed (the renderer masks it), never in a session file, and never in the environment of the `bash` tool (which gets only `PATH`, `HOME`, `LANG`, `TMPDIR`, `USER`, `TERM`). The one place a literal key may live is your own `agent.yaml`, at your choice. Shell history is kept in `<agent home>/history` (mode 0600) and holds only what you typed at the prompt, never the hidden key prompt.

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

## Reading the output

Streamed text goes to stdout and the rendered events go to stderr. With `-p`, **stdout carries only the final text**; `--verbose` adds the tool calls and event lines on **stderr**, so merging the two streams (`2>&1`) shows the streamed text and then the final text again. Read them separately, or drop `--verbose`.

A request that fails is one line. An endpoint that answers with an HTML page — a Cloudflare bot challenge, a gateway error — is reported as the status, the page title and a hint, never as the raw page; the built-in agent already sends `User-Agent: weave-agent/<version>` by default, and a provider profile's own `user-agent` header replaces it.

A model that writes its tool calls as message text (DeepSeek's `<｜DSML｜invoke …>` form) instead of structured `tool_calls` fails the turn as `text_tool_calls` (family `tooling`); nothing in that text is run. A provider profile that sets `compat.tools.supported: false` fails a turn that needs tools at start as `tools_unsupported`, before any request. To capture the exchange for a suspect endpoint, run one turn on the weave runtime with the `debugWire` run option set to true (the REPL has no such flag); the redacted request and response land in the run's `wire` directory beside its spill directory.

## Not verified here

Every automated check runs against the mock provider; a real turn from a real terminal on a real endpoint has to be run by a person (`weave repl -p "say hi" --provider … --base-url …`).
