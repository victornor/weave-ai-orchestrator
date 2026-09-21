## Why

On VS-639 the built-in agent ran deepseek-v4.1-flash through codeify (`https://codeify.cc/v1`). The model answered with its native tool-call syntax as plain message text (`<｜｜DSML｜｜ invoke name="bash">` …). The child saw no structured `tool_calls`, ran nothing, and the turn ended as an ordinary text-only stop. VS-653 made an empty worker turn visible (`empty_turn`) but still cannot say *why* it was empty. The cause (our request, the model, or the backend behind the gateway) is not established, and the live provider key cannot be used from a ticket, so no live capture exists.

## What Changes

- The child recognises a reply that carries a known text-form tool-call marker (DeepSeek DSML) but no structured tool calls, while tools were offered, and fails the turn as `tooling` / `text_tool_calls`. The message says the model wrote tool calls as text, names the model and provider, and points at `tools.supported` and `debugWire`. Nothing is executed. The recognition is a diagnostic only: it never produces a tool call.
- A provider profile that declares `compat.tools.supported: false` fails a turn that needs tools at start, as `tooling` / `tools_unsupported`, before any request is sent. Today the codec silently drops the tool list, which produces exactly the inert turn this ticket is about.
- No text parser is added. Choice: refuse clearly rather than parse, because parsing needs the DSML grammar confirmed against real bytes, which we do not have, and executing text is a permission-relevant surface. Parsing stays possible later, opt-in per profile.
- The exact `debugWire` capture command for the owner to run against the live provider is documented on the ticket.

## Capabilities

### Modified Capabilities
- `builtin-agent`: text-form tool calls and declared-unsupported tools fail as `tooling` instead of an empty success.

## Impact

`packages/agent/src/loop.ts`, a small new `packages/agent/src/textToolCalls.ts`, `errors.ts` (two stop errors), tests beside them. No protocol, schema or permission change.
