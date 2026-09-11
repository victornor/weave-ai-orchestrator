## Why

A workspace can run its tickets on different model tiers — the worker model options (`quick`, `standard`, `deep` today). A ticket already records the option it was filed with (`workerModelId`), but no surface shows it. Once more than one tier is configured, a human reading the board cannot tell a cheap ticket from a deep one without opening each ticket. (Captain, 2026-09-11, VS-217.)

## What Changes

- The board and the live view show a small tag carrying the worker model **option id** each ticket runs on — `quick`/`standard`/`deep`, not the runtime or the underlying model name.
- The tag appears only when **more than one** worker model option is configured. The gate is derived from the effective catalog at render time (the `GET /models` data, daemon overlay included) — no hardcoded count, no hardcoded ids.
- A ticket with no stored option id shows `default`, and so does a ticket whose stored id has since left the catalog — both run on the workers setting on their next turn (`modelSettingFor` falls through, `model-selection/worker-options`). The default is labelled, never left blank, so absence never has to be interpreted. (Decision detail in design.md.)
- One component renders the tag on every surface that shows a ticket as work: the kanban card, the phone board row, the board table, the workspace Live cell and the global Live cell.
- Display only. Nothing about how `workerModelId` is set, resolved or changed moves; the tag is not a control.

## Capabilities

### New Capabilities

- `workspace-navigation/worker-model-tags`: when several worker model options are configured, board cards and live cells carry a small tag naming the ticket's tier; the visibility gate is derived from the configured options; a ticket on the workers default is labelled explicitly; the tag reads the same on every surface and survives the smallest live cell.

## Impact

- `packages/ui/src/components/WorkerModelTag.tsx` — new: the tag plus the pure label derivation (`workerModelTagLabel`).
- `packages/ui/src/components/TicketCard.tsx` — `TicketCard` and `TicketRow` gain an optional `workerOptions` prop and render the tag (badge row / meta line).
- `packages/ui/src/routes/Board.tsx` — one `useModels()` call, threaded to cards, rows and the table's Kind cell.
- `packages/ui/src/routes/Live.tsx` — one `useModels()` call; `LiveCell` gains optional `workerOptions`; the tag sits in the cell header's ticket-identity row.
- `packages/ui/src/routes/GlobalLive.tsx` + `packages/ui/src/api/hooks.ts` — `useModelsMany(ids)` (a `useQueries` fan-out over the existing `qk.models(ws)` key, so it dedupes with `useModels`) so global Live cells agree with workspace Live.
- Tests: `components.test.tsx`, `boardRoute.test.tsx`, `liveFloor.test.tsx`, `globalLive.test.tsx` (their `../api/hooks` mocks gain `useModels`/`useModelsMany` or they crash — a known pattern), plus a pure label-derivation test.
- No server, core, API, CLI, schema or shared-package change; `docs/API.md` needs no edit.
- Out of scope, deliberately: the project overview's "Work under way" section (a project page, not the board — noted here so its absence is a decision, not an oversight), and any way to change a ticket's tier from these surfaces.
