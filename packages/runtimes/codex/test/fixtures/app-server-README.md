Recorded from `codex-cli 0.154.0` `app-server` (stdio JSON-RPC), driven by a small script against a local mock OpenAI Responses provider and a scratch `CODEX_HOME` — no credentials. Each line is `{ms, dir, m}`: `>` client→server, `<` server→client, `stderr`, `exit`.

- `app-server-stream.jsonl`: one turn, a 3 s command with streamed output, then four agent-text deltas.
- `app-server-escalate.jsonl`: a command with `sandbox_permissions: require_escalated`; the server's `item/commandExecution/requestApproval` request, answered `{decision: "decline"}`; the item completes `declined` and the turn continues.
- `app-server-resume.jsonl`: `thread/resume` of the thread from the escalate recording; note the replayed `thread/tokenUsage/updated` for the earlier turn id arrives before this turn's `turn/start` result.

Host names and paths were rewritten. Re-record rather than hand-edit.
