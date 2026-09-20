# @weave-ai/agent

Weave AI's own agent: a small per-run child process that streams one turn against any OpenAI-compatible
Chat Completions endpoint, with `read` and `bash` tools, the run's `weave_*` tools over MCP, cancel, and
resumable JSONL sessions. `@weave-ai/runtime-weave` spawns it; the child protocol is in `src/protocol.ts`.

## Live check (run by a person, never by CI)

One real turn through the real loop against a real endpoint, from a scratch directory, keeping the raw
bytes of every response. The key is read from an environment variable and is never printed or written.

```sh
export MY_ENDPOINT_KEY=...            # the provider key, in your shell only
pnpm --filter @weave-ai/agent conformance \
  --base-url https://api.example.com/v1 \
  --model the-model-id \
  --key-env MY_ENDPOINT_KEY \
  --out ~/weave-captures/example-2026-09-20      # must be outside any git repository
```

It prints one PASS/FAIL line per check (turn completed, response streamed, tool call assembled, tool result
reached the model, final answer, usage reported, model reported), the wall time and harness memory, and
writes `request-N.json`, `response-N.sse` (the exact bytes) and `report.json` (with the stream shape:
comment lines, `[DONE]`, finish chunks, where usage sat, reasoning field names, whether tool-call ids repeat)
to `--out`. Attach that directory's contents to the ticket. `--auth none` skips the key; `--auth header:<Name>`
puts it in a named header. Pick an endpoint that is not an OpenAI newest-model one until Chat Completions
tool support there is confirmed.

Each `response-N.sse` becomes a fixture in `fixtures/` after redaction; until then the `gateway-*`, `zai-*` and
`openrouter-*` fixtures are reconstructions (see `fixtures/README.md`).
