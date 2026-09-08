## Context

Seven fields in `packages/ui/src/routes/Settings.tsx` save by calling a mutation from their `onBlur`
handler and nothing else: the workspace name (`:198-203`), the five `KnowledgeBudgetsSection` number
fields plus its bootstrap-digest field (`:291-314`, one `save()` closure shared via `BUDGET_FIELDS`),
`ProjectsSection`'s `maxWorkers` (`:385-391`) and `landingBranch` (`:394-408`) per-project row fields,
`ModelSettingFields`'s free-text model id (`:528-537`, the only one of the seven that also commits on
`Enter`, by calling `e.currentTarget.blur()`), and `ChannelsSection`'s Telegram allowlist (`:620-635`).
All seven use an uncontrolled `<input defaultValue=... onBlur=...>`, so there is no draft state to
inspect, no way to know a field is dirty except by comparing against the DOM, and nothing runs when the
component unmounts or the page unloads. `usePatchProject` and `usePatchConfig` (`packages/ui/src/api/hooks.ts:292-333`)
are plain `useMutation` wrappers with no bug in them — see proposal.md - Why. The dropdown/select/toggle
fields in the same file (YOLO, auto-merge, presentation surface, runtime/model pickers, the YOLO
per-project override) commit on `onChange` already and are unaffected: an atomic selection has nothing
for a reload to discard mid-edit.

There is no existing "commit a draft against a mutation" primitive in `packages/ui` to reuse. The
closest prior art, `packages/ui/src/lib/drafts.ts`'s `useDraft`, persists unsent chat/ticket text to
`localStorage` across reloads — a different problem (recovering text nobody tried to send yet) from this
one (committing text the human already finished typing).

## Goals / Non-Goals

**Goals:**
- One shared piece of logic behind all seven fields, so the fix is the pattern, not seven ad hoc
  patches (ticket AC #5).
- Preserve each call site's existing layout — a `<Field>` block, an inline `<label>` in a row, a grid
  cell — rather than forcing every site into one wrapper component's markup.
- Make "was this saved" answerable by looking at the field, not by opening a toast history or reloading.

**Non-Goals:**
- Any change to what a field validates or means (landing-branch remote check, budget minimums, allowlist
  id parsing) — proposal.md - What Changes already excludes this.
- Debounced autosave-while-typing. Committing only on an explicit action (Enter, the save control, blur,
  or unmount) keeps "was this saved" a discrete, answerable question at every moment; a debounce timer
  would mean the honest answer is sometimes "partway there," which is a worse fit for AC #2 than it looks.
- Persisting an uncommitted draft to `localStorage` so a fully killed tab could recover it later
  (`useDraft`'s approach). Considered and rejected for this change: it would make "backgrounding the
  app" strictly safer than "unmistakable that it was not saved," which is what the ticket actually asks
  for, at the cost of seven site-specific persistence keys, restore-on-mount UI, and invalidation once a
  save succeeds. If a future ticket wants that stronger guarantee, this design does not preclude adding
  it on top of the same draft/status state introduced here.

## Decisions

**A hook, not a wrapper component.** `useCommittableField(opts): { draft, status, error, onChange,
onBlur, onKeyDown, commitNow }` in a new `packages/ui/src/lib/commit-field.ts`. Each of the seven call
sites keeps its own `<input>` (type, size, aria-label, grid placement all differ) and spreads
`{ value: draft, onChange, onBlur, onKeyDown }` onto it, then renders a small shared
`<CommitStatus status={status} error={error} onSave={commitNow} />` next to it for the indicator and the
explicit save action. A single wrapping `<SettingsField>` component was considered and rejected: the
seven sites are laid out too differently (a `<Field label hint>` block, a `<label>` in a flex row, a
`<select>`-adjacent grid cell) for one wrapper's markup to fit without new layout props that would end
up as flexible as just keeping the JSX at the call site.

**The hook owns a raw string draft; the caller owns parsing and the mutation.** `useCommittableField({
value: string; onCommit: (raw: string) => Promise<void> })`. `onCommit` is where each site's existing
parse/validate/`mutate` logic lives (e.g. `Number(raw)` and the `>= 500` check for a budget field,
`raw.split(',').map(Number)` for the allowlist) — a rejected promise (thrown validation error or a
failed mutation) is what drives `status: 'error'` and the message shown. This replaces today's silent
`if (invalid) return` in `KnowledgeBudgetsSection.save()` with a real rejection, so an out-of-range
budget now says so instead of quietly doing nothing — a direct instance of AC #3, not a new rule.
`draft` resets to `value` only when the hook is not dirty and not mid-save, so a slow save in flight is
never clobbered by a query refetch landing in the middle of it.

**Commit paths: the explicit action, `Enter`, blur, and unmount — in that order of directness.** The
explicit action (rendered by `CommitStatus` whenever `status !== 'idle saved'`) and `Enter` both call
`commitNow()` synchronously from a user gesture. Blur keeps calling it too, since it is a real signal on
desktop and costs nothing to keep. Unmount is different: `useCommittableField` keeps a ref to the latest
`{dirty, draft, onCommit}` and, in its cleanup, fires `onCommit(draft)` without awaiting it — a
React Query mutation's request is not tied to the component's lifetime, so a fire-and-forget call from
an unmounting field still reaches the server. This is what makes "switching Settings sections"
(AC #1's "navigating away") safe without the human doing anything explicit.

**Reload and backgrounding are covered by the visible state, not by an intercept.** Neither a full page
reload nor the OS backgrounding a PWA runs any more JavaScript in this document, so nothing can flush a
draft in those cases — see Non-Goals on why this design does not attempt `beforeunload`-based persistence.
What it guarantees instead is that the field showed "unsaved" continuously from the moment it became
dirty, satisfying AC #1's second branch ("or makes it unmistakable that it was not saved") literally: the
information was on screen the whole time, not concealed by a control that looks the same whether the
edit stuck or not.

**Status values: `idle | dirty | saving | saved | error`, with `saved` transient.** `saved` reverts to
`idle` after a short delay (a couple of seconds) so the field doesn't carry a permanent "saved" caption
once nothing is happening — `idle` renders no indicator at all, matching every field's current quiet
appearance before this change. Tests assert the state transitions (`dirty` on change, `saved` once the
mutation resolves, `error` with the message once it rejects) rather than the exact fade timing.

## Risks / Trade-offs

- [A human can still lose an edit by reloading the instant after typing, before even the "unsaved" state
  has rendered a frame] → not fully closable without the `localStorage`-draft approach rejected above;
  narrowed to a single frame instead of the current "any time before blur," which on a phone could be the
  entire session. Acceptable per AC #1's own wording (unmistakable, not: unloseable).
- [Firing `onCommit` from an unmount cleanup with no way to await it or show its result] → acceptable
  because the alternative (not flushing on unmount at all) is the exact bug being fixed for in-app
  navigation; a failure here is no worse than today's silent loss, and a success is strictly better. The
  field showed "unsaved" up to the moment of unmount, so nothing claims a save happened when it didn't.
- [Seven call sites each wire the hook slightly differently (number parsing, csv parsing, trimming)] →
  the parsing stays exactly where it already lives today (inline per field); only the commit trigger and
  the visible state move onto the shared hook, so this is not a new source of drift beyond what already
  exists.

## Migration Plan

No data or API migration — this is a client-only behavior change. Ship order: the `useCommittableField`
hook and `CommitStatus` component first (independently unit-testable against a fake `onCommit`), then
each of the seven call sites in `Settings.tsx`, then the `Settings.test.tsx` cases from AC #6. Each call
site's conversion is independent and leaves no broken intermediate state, so they can land as separate
commits within this change. Verification per the ticket: reproduce the original loss first (type into
the landing-branch field at a phone viewport width in a real browser, reload without tapping elsewhere,
confirm the value is gone today), then confirm the same steps keep or visibly flag the value after the
fix, and state both in the PR.
