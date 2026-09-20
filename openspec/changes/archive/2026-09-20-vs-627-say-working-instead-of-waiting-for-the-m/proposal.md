## Why

Between two steps of a turn every live surface currently reads "Waiting for the model". Captain wants the
plain word: a person watching a persistent session, the weaver chat, the planner chat, a worker page, the
V2 work cards, the TUI or a channel progress message should read `Working`, not a phrase about the model.
This deliberately reverses the earlier "never a bare working state" wording in three specs — the point was
never the word, it was that the row must always carry the elapsed seconds, tool count and other states.

## What Changes

- The label for the `waiting` live-turn state becomes `Working` on every surface that renders it — the web
  activity row, the V2 board card, the TUI `ActivityLine`/`weave top`, `weave runs tail` and the channel
  progress text. The seconds, the tool count, the turn total and every other state (writing, thinking,
  running a named tool, starting, whole-steps-only) are unchanged.
- The state id stays `waiting`; no stored data, API field or event payload changes. Only the words.
- The three capability specs drop their "waiting for the model" wording and the `, not "working"` clause,
  and read `Working` instead, while keeping the rule that the row is never a bare status word: the label
  always carries the elapsed seconds and the tool-call count.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `live-run-progress`: the `waiting` state's rendered words become `Working`; the requirement is reworded so
  "never a bare working state" keeps meaning "never the word alone without the seconds and tool count".
- `interface-live-progress`: the weaver-chat and terminal-UI scenarios that quote the state read `Working`;
  the "bare working" rule is kept.
- `channel-progress`: the generic progress word for the `waiting` state becomes `Working`, so an external
  channel now shows `Working` for both a running tool and a between-steps pause (the tool name was already
  hidden there); the elapsed seconds and tool count still distinguish them.

## Impact

- Source: `packages/render/src/liveTurn.ts` (the `waiting` `label` and `PROGRESS_WORD`), plus behaviour-
  describing comments in `packages/render`, `packages/core/src/activity`, `packages/ui`, `packages/tui`.
- Tests and goldens asserting the old wording: `packages/render/src/liveTurn.test.ts`,
  `packages/core/src/activity/activity.test.ts`, `packages/ui` (`RunTranscript.test.tsx`, `workerActivity`,
  `activeRunLine`, `v2work`), `packages/tui` (`ActivityLine.test.ts`, `Top.test.ts`),
  `packages/cli/src/commands/runs.test.ts`, `packages/server/test/channels.test.ts`.
- Specs: `openspec/specs/live-run-progress`, `interface-live-progress`, `channel-progress`.
- No route, schema, migration or API change; `docs/PLAN.md` and `docs/API.md` are untouched.