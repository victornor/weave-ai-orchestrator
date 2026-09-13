# Say "Weaver" everywhere a person or agent reads the name

Tracker change for [VS-325](weave://tickets/VS-325).

## Why

Captain, 2026-09-13: "We're still calling it Conductor. It's now a Weaver. And the chat still shows
Conductor at the top left. I don't know why. We're like pretty deep into this rename. It should be
Weaver everywhere now." He was replying to a chat line that read **Conductor reviewed** a merge
decision.

The earlier rename tickets covered the machine layers — the agent kind and stored kind values
(VS-259), packages, the CLI and the service (VS-260), config keys and API fields (VS-263), the web
manifest (VS-292) — and left the human-readable name alone. The result is that the product is
called Weave, the daemon and CLI are `weave`, the agent kind is `weaver`, and yet every place a
person or an agent actually *reads* the role still says "Conductor": the chat header, the review
line, the Settings model labels, and the stored agent's own name.

## What Changes

- **Web app labels** (`packages/ui/src`): the chat header title, the "… is replying — your message
  is queued" and "… is deciding" status lines, the Team section label, the workspace-knowledge hint,
  and the three Settings model/presentation `label="Conductor"` props all read "Weaver".
- **Stale Settings pointers** (`packages/ui/src/lib/dictation.ts`, `components/Composer.tsx`): four
  help/error strings that say "Settings → Conductor" now point at "Settings → Dictation", the
  section that actually holds the transcription-provider setting. There is no Settings section named
  "Conductor"; the old pointer named a place that does not exist. See design.md.
- **Server-written text**: the decision-review follow-up in `channels.ts` reads "Weaver reviewed …";
  the presenter route summary in `routetable.ts` reads "Weaver + worker views …".
- **Core seed text**: the seeded WORKSPACE.md blurb ("Conductor-only") in
  `knowledge/files.ts` and the workspace-layout skeleton in `workspace/loader.ts` read "Weaver-only".
- **TUI**: the terminal title in `tui/src/apps/Chat.tsx` reads "Weaver".
- **Agent-facing skills/templates**: the four capitalised display-name occurrences in shipped skill
  files (`weave-ai-knowledge`, `weave-ai-worker/references/tools.md`,
  `weave-ai-weaver/references/examples.md`) read "Weaver".
- **Stored agent name (migration)**: a new migration renames the untouched default
  `agents.name = 'Conductor'` to `'Weaver'` for `kind = 'weaver'`, and leaves a deliberately
  customised name alone. New workspaces already create their weaver as `Weaver`
  (`packages/core/src/workers/index.ts`), so only the data fix is needed.

Out of scope, per the ticket: internal code identifiers (`isConductor`, `ensureConductor`,
`ConductorReviewLine`, `askedByConductor`, …), the `agent-conductor` repository name, legacy
on-disk paths VS-258 keeps readable, and the deliberately-kept legacy `'conductor'` string values
(config keys, `WAKE_SOURCES`' `conductor_request`, on-disk policy spellings, stored kind values
before 0027) — an identifier or a wire value is not display text. Lowercase prose uses of the role
noun ("the conductor" as a concept) are likewise not a display name; only the capitalised name a
reader sees is renamed. See design.md Decision 1 for why.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `product-rename`: adds the guarantee that the human-readable role name a person or agent reads is
  "Weaver", and that the stored default-named weaver is renamed while a custom name survives.

## Impact

- `packages/ui/src`: `routes/Chat.tsx`, `routes/NeedsYou.tsx`, `routes/Team.tsx`,
  `routes/Settings.tsx`, `components/Composer.tsx`, `lib/dictation.ts`, plus the UI tests that
  assert these labels (`models.test.tsx`, `presentation.test.tsx`, `globalMap.test.tsx`,
  `components.test.tsx`, and the chat/team/needsyou tests).
- `packages/server/src`: `channels.ts`, `routetable.ts`; `packages/server/test/channels.test.ts`.
- `packages/core/src`: `knowledge/files.ts`, `workspace/loader.ts`; the knowledge files test.
- `packages/tui/src/apps/Chat.tsx`.
- `skills/weave-ai-knowledge/SKILL.md`, `skills/weave-ai-worker/references/tools.md`,
  `skills/weave-ai-weaver/references/examples.md`.
- `packages/db/src/migrations/`: a new migration + `migrations.test.ts`.
- No API, config, dependency or build change. No machine-readable identifier changes, so nothing
  that reads the old code breaks.
