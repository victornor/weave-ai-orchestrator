## Decision

Add one exemption to the existing VS-653 condition in `finalize`: a `tool.call` run event named
`StructuredOutput` for this run. Run events are already persisted before `finalize`, so the check is
one indexed query on `run_events` (`json_extract(payload_json,'$.name')`).

Alternatives rejected:
- Exempting `merging` (or any status) wholesale: a merging worker that can truly not act should still be caught.
- Exempting by the report's `state`: the point is the report may be unreadable, so its state is unknown.
- Recovering the report from the tool call's input and using it as the report: would also fix liveness, but needs the transcript to confirm the cause; deferred.

The message is reworded in place; nothing parses it.
