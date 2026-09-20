## 1. Schema, merge, secrets, resolution (turn 1)

- [x] 1.1 Add `providers`, `mcpServers` to `DaemonConfigSchema`; `disabledProviders`, `disabledMcpServers` to `WorkspaceConfigSchema`; confirm `runtime-options` accepts a `weave` option naming a daemon provider; schema tests
- [x] 1.2 Pure `mergeScoped` in core with `source` marks; unit tests (daemon-only, override, add, disable, restore)
- [x] 1.3 Daemon secret store (`daemon-secrets.enc/.key`) and one `resolveSecret` (workspace then daemon); tests incl. workspace-wins
- [x] 1.4 Loader exposes effective providers/MCP servers, refreshed on daemon config write
- [x] 1.5 Runtime host and engine use the merged set and resolver; redaction covers daemon secrets; unknown allowed MCP server fails the run; tests incl. workspace-only regression
- [x] 1.6 Daemon routes (providers, mcp-servers, secret, test) via a scope-parameterised handler; workspace routes return `source`/`disabled`; routetable and route tests; no value in any response

## 2. UI, repl, docs (turn 2)

- [x] 2.1 Providers and MCP sections registered in the daemon scope; workspace scope shows inherited (marked), Override, Remove override; render tests in both themes
- [x] 2.2 A `weave` worker option on a daemon provider can be created in Models UI; test with a mock provider
- [x] 2.3 `weave repl` reads `daemon.yaml` and the daemon secret store; precedence and literal-`apiKey` tests
- [x] 2.4 Docs: running-the-agent-yourself, builtin-agent-design (reversal of open question 3, 2026-09-20), `docs/API.md`
- [x] 2.5 Full core/server and UI suites once with `--maxWorkers=4`; both blocks pasted
