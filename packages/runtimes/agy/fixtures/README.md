# agy fixtures (VS-995)

Real bytes from agy 1.5.14. No fixture here was written by hand.

| File | Source |
|---|---|
| `turn1-tool-schema.jsonl` | Owner capture, 2026-11-22 (`scripts/capture-agy-fixtures.sh`): `-p … --output-format stream-json --json-schema … --model gemini-4-neon-low --dangerously-skip-permissions`, one MCP tool call |
| `turn2-resumed.jsonl` | Same capture: turn 2, `--conversation <turn 1's id>`. Its `result.usage` is cumulative over the conversation |
| `model-effort-conflict.stderr.txt` | Same capture: `-p /model --model gemini-4-neon-high --effort low` (exit 1) |
| `model-base-effort.stdout.txt` | Same capture: `-p /model --model gemini-4-neon --effort high` (exit 0) |
| `valueless-p.stderr.txt` | Same capture: prompt on stdin with a trailing valueless `-p` (exit 2, first line) |
| `no-login.stderr.txt`, `no-login-result.jsonl` | `bwrap` sandbox with no credential and a terminal-less stdin; `state`/`code_challenge` replaced with values containing `429`/`503` |
| `no-login-fast.stderr.txt` | The adapter's own `runTurn` against the real binary in the sandbox, spawned with no terminal |
| `mcp-list-one.txt`, `mcp-list-empty.txt` | Sandbox: `agy mcp list` with one seeded server, and with an empty config |
