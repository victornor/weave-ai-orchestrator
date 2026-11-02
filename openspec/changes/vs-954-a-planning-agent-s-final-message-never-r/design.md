## Context

`weave_plan_reply` is the only documented delivery for a planner (`tools.ts`), and the prompt says plain
text is only a run summary. Models nonetheless sometimes close a long turn with the answer as prose
instead of the tool call. The summary is `finalText.slice(0, 1000)`, which is why the three lost runs have
summaries cut mid-sentence; the slice is a symptom, not the cause. Nothing in the length of the text
itself blocks `threads.outbound` (no size limit in that path). Also checked: the correlation with length is
that long answers are the ones composed as closing prose.

## Decisions

1. **Fallback delivery in the engine, not a reply-tool change.** Mirrors `deliverSessionAnswer`: after
   finalize, for `agent.kind === 'planner'` with a plan, succeeded run, non-empty final text that is not a
   run report, and no outbound message carrying this run id in the plan's thread -> post `finalText`
   (trimmed, full length). Alternative considered: failing the run when the tool was not used. Rejected:
   captain would lose the answer *and* get an error; posting is strictly better.
2. **Visibility via run events, not status.** The answer is delivered, so `succeeded` is accurate. A
   `run.delivery.fallback` event records that the tool path was skipped; `run.delivery.failed` records a
   failed post. Both use the existing `runtime.raw` event type with `originalType` (as VS-943 did), so no
   new event type or schema.
3. **A tools-only turn stays silent.** No final text means nothing to deliver; unchanged.
4. **Prompt unchanged.** Planners are still told to use `weave_plan_reply`; the fallback is a net.

## Risks

A planner that replies via the tool *and* ends with a wrap-up line: the outbound-for-run check suppresses
the fallback. A planner that replied via the tool in an earlier run but only prose this run gets the prose
posted - intended.
