## Why

Captain (2026-09-08), right after VS-122 shipped the landing-branch field: "there's no save button, so
i can write edge, but then i reload and it's back to empty lol...". The database confirms it:
`landing_branch` is still `null` for both projects, and nothing was logged as rejected — the request
never went out. Every text/number field in Settings that saves on edit commits only from `onBlur`
(`Settings.tsx`: workspace name, the five knowledge-budget fields plus the bootstrap-digest budget, a
project's `maxWorkers`, a project's `landingBranch`, a model's free-text id, and the Telegram
allowlist). `onBlur` never fires on a page reload, a backgrounded PWA, or a JS-triggered navigation —
the field loses focus without the browser ever dispatching a blur event — so a typed value that hasn't
been blurred yet is silently discarded, exactly matching captain's account, and confirmed by reading
every one of these fields: none has a save control, an unsaved-state indicator, or an unmount-time
flush. The mutation hooks themselves (`usePatchProject`, `usePatchConfig`) are unremarkable PATCH
calls with no bug in them — the loss happens entirely in the browser, before a request is ever sent.
Captain uses this app from a phone constantly, so this reaches every field with the pattern, not only
the one that was reported.

## What Changes

- A new shared field-commit primitive for Settings' free-text/number inputs, replacing the bare
  `onBlur={() => mutate(...)}` pattern at all seven call sites named above. It tracks its own draft
  against the last-saved value and exposes a visible status — unsaved, saving, saved, or errored — next
  to the field, so leaving the page no longer needs to be preceded by a successful blur for the human to
  know what happened.
- An explicit, visible way to commit a dirty field without blurring it: a small Save action that
  appears only while the field is dirty (direct answer to "there's no save button"), in addition to
  `Enter` committing the value (already true only for the model free-text id today; every other field
  gains it) and blur still committing as a convenience, not a requirement.
- Unmounting a dirty field (switching Settings sections, navigating away inside the app) flushes the
  pending edit instead of discarding it silently, closing the SPA-navigation half of the bug; a full page
  reload or the app being backgrounded cannot be intercepted this way, which is why the visible
  unsaved/saving/saved state, not just the flush, is the AC #1 guarantee for that half.
- A rejected save no longer overwrites what the human typed. Today the landing-branch field reverts to
  the old server value on error, which the ticket calls out as close to the original bug (typing
  silently discarded); every field keeps the human's draft on a rejected save and shows why it failed,
  so the value can be corrected and retried without retyping it.
- No change to what any of these fields validate or mean — the landing branch's remote-existence check
  (VS-122), the knowledge-budget minimums, and the allowlist's id parsing are unchanged; only when and
  how the commit happens, and what the human sees when it does or doesn't, changes.

## Capabilities

### New Capabilities

- `web-settings/field-commit`: how a Settings text/number field commits an edit (explicit save action,
  `Enter`, blur, and unmount-flush), how it shows the human whether the edit was saved, and how a
  rejected save is presented without discarding the typed value.

### Modified Capabilities

(none — `web-settings/settings-scopes` covers area/section layout, not per-field save behavior, and is
untouched by this change)

## Impact

- `packages/ui/src/routes/Settings.tsx` — the workspace name field, `KnowledgeBudgetsSection`'s six
  number fields, `ProjectsSection`'s `maxWorkers` and `landingBranch` fields, `ModelSettingFields`'s
  free-text model id, and `ChannelsSection`'s Telegram allowlist field all move onto the new primitive.
  Fields that commit on `onChange` alone today (the auto-merge/YOLO/presentation selects, the model and
  runtime dropdowns) are out of scope — an atomic selection has nothing for a phone reload to lose.
- A new small module under `packages/ui/src/lib/` (or `packages/ui/src/components/`) holding the
  commit primitive (hook + the visible status affordance), reused across all seven call sites rather
  than duplicated.
- `packages/ui/src/routes/Settings.test.tsx` — new cases per AC #6: a dirty field survives an unmount
  without a blur, the visible confirmation appears and clears, and a rejected save keeps the typed text
  and shows the error.
- No server, schema, or API changes: every field already PATCHes the same endpoint it does today: this
  is a client-only change to when and how that PATCH is sent and shown.
