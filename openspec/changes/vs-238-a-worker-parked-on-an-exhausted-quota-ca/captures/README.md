# Captured quota strings (2026-09-11)

Quoted in design.md. Copied here so apply writes parser tests from these bytes, not from memory.

| File | Source | Notes |
|---|---|---|
| `vs-234-opencode.txt` | [VS-234](conductor://tickets/VS-234) live `provider_quota` on OpenCode standard, 2026-09-11 | Naive `YYYY-MM-DD HH:MM:SS`. No timezone. Real instant is `2026-09-11T17:54:35Z`, not UTC. |
| `vs-234-opencode.meta.txt` | Conductor, from this workspace's run history, 2026-09-11 | `failure_now` is the parser's `now`. Window start is not. |
| `claude-until-your-limit-resets-at.txt` | `strings` on installed Claude CLI; not executed | Template prefix. Formatter `Ou` is in design.md. |
| `claude-monthly-spend-limit.txt` | same binary | No timestamp — fallback to `retry_1h`. |
| `codex-youve-hit-your-usage-limit.txt` | `strings` on installed Codex CLI; not executed | No timestamp in the user-facing string. |
