## Context

VS-595 built the runtime-neutral live model (`liveTurn`), VS-602/603 wired it into every web and terminal
surface, and VS-604 reused it for generic channel progress. The `waiting` state — a turn between a completed
tool result and the next event — is rendered by that one model, so its words live in a single place. Captain
wants the plain word `Working` instead of `Waiting for the model` on every surface. This deliberately
reverses the three specs' "waiting for the model … not 'working'" wording; the rule those specs were reaching
for (a row is never the word alone, with no seconds, tool count or named state) is kept.

## 1. One string, one source of truth

`packages/render/src/liveTurn.ts` derives every live label; no consumer keeps its own wording for a state.

| state | product label (`liveTurn.label`) | channel word (`PROGRESS_WORD`) |
|---|---|---|
| `starting` | Starting the turn | Starting the turn |
| `streaming` | Writing | Writing |
| `thinking` | Thinking | Thinking |
| `tool` | `Running <name> <target>` | Working |
| `waiting` | **Working** (was `Waiting for the model`) | **Working** (was `Waiting for the model`) |

Two writes change: the `waiting` return in `liveTurn` and `PROGRESS_WORD.waiting`. Consumers — the web
`LiveActivity` row, the V2 `workerActivity`/Work card/RunsPage/DecisionCard, the TUI `ActivityLine` and
`weave top`, `weave runs tail` and the daemon's channel progress driver — read the derived `label`/`state` and
need no code change. The state id stays `waiting`; no stored row, event payload or API field changes.

## 2. The collision with the existing "Working" (ticket scope 2)

Three things already read "Working"; each is checked, and none is "shown twice" with the new label:

1. **A running tool on an external channel** already renders `Working` via `PROGRESS_WORD.tool`. After this
   change a between-steps `waiting` state also renders `Working`, so a Telegram message reads `Working · 12 s`
   whether a tool is open or the model is generating. The two states are never simultaneous, the channel word
   was already deliberately generic (the tool name and target are hidden), and the elapsed seconds and tool
   count still move — the channel now reads `Working` continuously through a turn, which is the requested
   behaviour. **Kept, and written into the `channel-progress` delta.**
2. **`workerActivity`'s unknown-tool fallback** is the per-event activity label `Working` (verb `working`).
   On every surface the live line takes precedence over the per-event line (`activityLine`,
   `mergeWorkerActivity`), and a live run always has a live state, so the two can never render together. **Not
   changed.**
3. **The run/worker status word `working`** (`statusLabel`, lowercase) is never shown beside a live line:
   `weave top` uses it only as the last fallback when there is no live or activity line; the runs list falls
   back to the run status (`running`) when no live frame arrives; a board card renders a status glyph (an
   icon, no word) plus the line. **Not changed.**

So the only merge is (1), it is intended, and no surface can print the word twice on one row.

## 3. What changes, exactly

- `packages/render/src/liveTurn.ts`: the `waiting` label and `PROGRESS_WORD.waiting`; the two doc comments
  that quote the old phrase.
- `packages/core/src/activity/index.ts` and `packages/ui/src/components/LiveActivity.tsx`,
  `packages/tui/src/components/ActivityLine.tsx`: behaviour-describing comments that quote the old phrase.
- Tests/goldens asserting the old string become `Working`:
  `packages/render/src/liveTurn.test.ts`, `packages/core/src/activity/activity.test.ts`,
  `packages/ui/src/test/{workerActivity,activeRunLine,v2work}.test.*`,
  `packages/ui/src/components/RunTranscript.test.tsx`,
  `packages/tui/src/components/ActivityLine.test.ts`, `packages/tui/src/apps/Top.test.ts`,
  `packages/cli/src/commands/runs.test.ts`, `packages/server/test/channels.test.ts`.
- The `v2work` card case currently asserts `queryByText('Working')` is null; it is rewritten to assert the row
  shows `Working` with its seconds and never a bare status word.
- The three delta specs in this change: `live-run-progress`, `interface-live-progress`, `channel-progress`.

## 4. What must not change

The `waiting` state id; anything stored or sent (events, `worker.activity` payload, `GET /runs/:id/live`);
`routing`/status text for runs and workers; the elapsed seconds, tool-call count, turn total and the wording
of every other state (writing, thinking, running a named tool, starting, whole-steps-only). Matches on the
label text rather than the state were checked — the only label comparison in source is a stability check
(`activity/index.ts:175`), which is not a behaviour match — so nothing matches on the old string.

## 5. Evidence

The changed wording is judged by eye. Capture the live row in a persistent session, the weaver chat and the
planner chat while a turn is between steps, in both themes, from a scratch harness **outside the worktree**
(no coding CLI, no live credentials; a component/story render with a seeded `waiting` live state). Open each
image and confirm it reads `Working` with its seconds before attaching them to the ticket with
`weave_ticket_attachment_put` — nothing is left in `work/`.