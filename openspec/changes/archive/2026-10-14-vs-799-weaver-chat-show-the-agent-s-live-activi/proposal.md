## Why

Captain watched the weaver run ~18 tool calls and saw only a bare "running" indicator. Root cause, confirmed in `packages/ui/src/lib/liveRunPrefs.ts`: the weaver chat's streamed text and mid-turn tool trace are gated behind the browser-local pref `conductor.chat.liveRunOutput`, which defaults to **off** (`readShowLiveRunOutput` returns true only when the stored value is `'on'`). There is no per-user store and nothing tells the user the toggle exists. The live model itself (`liveTurn`, run-event stream, `LiveSection`) already works.

## What Changes

- `readShowLiveRunOutput` defaults to **on**: only an explicit stored `'off'` (a user who turned it off in Settings) hides the live section. A fresh profile shows live activity with no opt-in.
- The Settings toggle "Live weaver output" is kept, now reading as on by default; its description is updated.
- Unchanged: the live section is replaced by the final message when the turn finishes; the planner chat (PlanTab) already streams and shares the component.
- Tests: the "off by default" chat test becomes "on by default" plus an explicit-off case; the prefs test asserts the new default.

## Impact

`packages/ui/src/lib/liveRunPrefs.ts`, `packages/ui/src/settings/sections.tsx` (copy), `packages/ui/src/test/liveRunPrefs.test.ts`, `packages/ui/src/test/v2chat.test.tsx`. No server or API change.
