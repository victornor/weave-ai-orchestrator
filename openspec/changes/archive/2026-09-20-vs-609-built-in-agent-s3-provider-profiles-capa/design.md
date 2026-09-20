## Context

Design lives in the knowledge base (`builtin-agent-design` section 4). Captain's decisions of 2026-09-20 override it: provider profiles in workspace config, chat-completions only, no cost/pricing, `WEAVE_LLM_<PROVIDER>_KEY` secrets. S1 already landed `attach?` and `RuntimeHost.providers()`, so this slice does not touch `daemon.ts` beyond what the route needs.

## Decisions

- **Resolution is a pure function** `resolveProvider({preset, profile, model, options, effort})` returning `{compat, params, headers, extraBody}`; the adapter resolves once per turn and sends the resolved values in `init.provider`, so the child never sees layers. Precedence is field-wise: a set value at a higher layer replaces the lower one; `omitParams` and `extraHeaders` are unioned; `null`/unset never overrides.
- **Presets are JSON in `packages/agent/presets/`**, loaded with the schema, each flag optionally tagged in a sibling `verified` list naming its fixture. Built into the package (imported JSON) so no fs lookup at runtime.
- **Codec takes resolved params**. `buildRequest` sends only set parameters, renames the output cap by `maxTokensParam`, drops anything in `omitParams` last (so even `extraBody` cannot bring it back), merges `extraBody` before the omit pass, sets `stream_options` per `streamUsage`, role per `systemRole`, and passes reasoning back only on tool steps of the current turn when `passBack` says so.
- **`extraBody` is a JSON string, `extraHeaders`/`stop` `string[]`** because `RuntimeOptionValue` has no objects.
- **Discovery lives in the adapter** with a per-provider in-memory 10-minute cache; any failure returns the static list. Context window from `contextField` when present.
- **Concurrency**: one semaphore per provider id, held for the child's lifetime, waiting is abortable.
- **Retry cap**: an error body matching "routes failed after N attempts" is classified `transient_upstream` but marked non-retryable by the child beyond one retry.
- **Split**: part (a) resolver, flags, presets, schema, fixtures; part (b) discovery, semaphore, conformance, route. Committed separately; may span two turns.

## Risks

Flags are `verified:false` unless a recorded fixture proves them; the weaver runs live conformance later. Real capture files are outside the repo and are copied (sanitised) into `packages/agent/fixtures`.
