## Context

`loop.ts` treats a step with `parsed.length === 0` and a non-`length` finish as the end of the turn. `codec/chatCompletions.ts` sends `tools: []` when `compat.tools.supported` is false. Both paths give a silent, text-only success.

## Decisions

1. **Detect, do not parse.** `detectTextToolCalls(text)` returns the marker family (`dsml`) when the text contains `<｜DSML｜` or `<|DSML|` (with the doubled full-width bar variant seen in VS-639) followed by an `invoke` tag. Fixtures are taken from the VS-639 run text quoted on the ticket; the real capture is still owed by the owner. Only known markers match, never a regex over arbitrary prose, and the result only selects an error message.
2. **Fire only when it is a failure.** The check runs where `parsed.length === 0` and the step would end the turn, and only when tools were offered. A step with real tool calls is untouched, so a model that quotes DSML in an answer alongside real calls is unaffected.
3. **Error shape.** `stopError.textToolCalls(model)` → `{code: 'text_tool_calls', family: 'tooling'}`; `tooling` is not re-queued by the run engine (see the `stopError` comment), so it does not loop.
4. **Declared unsupported.** Before the first request, if `compat.tools.supported` is false and the tool list is non-empty, fail with `tools_unsupported`/`tooling` naming the provider and model. The probe already writes `supported:false` from a real check, so this consumes an existing flag.
5. **Smaller safe option.** Parser rejected for now: larger, needs the grammar from real bytes, and executes model text.

## Risks

A model that legitimately answers with DSML text and no calls is failed; that is the intended trade, since it is indistinguishable from the bug.
