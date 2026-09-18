# Design — Move the planning agent from its modal into a tab in the weaver chat

## Context

See `proposal.md` — Why. The current state that shapes the approach:

- `ChatPage.tsx` (`V2ChatPage`) renders the weaver chat: a 38px `ChatStatusBar`, the shared
  `ChatConversation`, a `ChatComposer` whose toolbar carries **Search** and **Plan**, a decisions
  pane on wide viewports, and a `PlanModal` opened by the Plan button.
- `PlanModal.tsx` already does everything a plan tab needs, but wrapped in modal chrome: an overlay +
  centered dialog/full-screen sheet, its own **Plan** header with a project tag strip, its own inner
  plan tab list (VS-477) with rename/delete, the planner conversation through the shared
  `ChatConversation`/`ChatComposer` (VS-442), and a drafts aside with per-draft edit, reorder, tier
  override, scout dispatch, dispatch state and **Submit** (VS-398/VS-517). Plans are server state:
  `usePlans`, `usePlan`, `useCreatePlan`, `useRenamePlan`, `useDiscardPlan`, `useSubmitPlan`, and a
  last-focused tab is already remembered on the device in `localStorage`
  (`weave:plan:lastTab:<ws>:<projectId>`; the key becomes per workspace now the strip is
  workspace-wide).
- Sibling tickets in the same UI-polish block touch the same files: VS-549 (collapse an empty
  decisions pane; show the chosen roadmap block on sent messages) and VS-554 (may factor
  `contextStrip` for the Live view). This branch is expected to rebase onto them and keep their
  behaviour.

## Goals / Non-Goals

**Goals:**

- The weaver conversation and every `drafting` plan in the workspace are peer tabs in one strip, each
  plan tab tagged with its project; the plan surface keeps every control the modal had, with no
  modal.
- Tabs are server-state-driven, so they survive a reload without a new persistence mechanism, and the
  device-remembered focus extends to cover the weaver tab.
- The plan conversation stays the same shared code as the weaver chat, so parity is structural rather
  than re-implemented.

**Non-Goals:**

- Any server, API, schema, daemon or planner-lifecycle change: the plans routes are used exactly as
  the modal used them.
- Re-doing the plan conversation or composer, the draft editor, scout dispatch, the decisions pane or
  the status bar; those are reused as they are.
- Reordering, pinning or closing a tab without discarding its plan. Tab set = the workspace's
  drafting plans, plus the weaver tab; submission and discard are how a tab goes away (as the modal
  already behaved).
- V1's chat.

## Decisions

### The tab strip is a dedicated row at the top of the chat, and the status bar stays the weaver tab's

The strip is a new 38px row above the existing content, carrying the weaver tab, one tab per drafting
plan in the workspace and **New plan**. The existing `ChatStatusBar` remains inside the weaver tab, so the weaver-only
figures (the session meter, **Compact now**) never paint over a plan tab, and the plan tab does not
need a second status bar. The strip is the only new global chrome.

Alternative considered: fold the tabs into the existing status bar by replacing its static "Chat"
label. Rejected as the default because the bar's figures are the weaver's (the session limit is the
weaver's conversation), and a plan tab has no equivalent bar to gain; keeping the strip separate
avoids inventing a planner session meter and keeps the weaver bar byte-identical.

### One workspace-wide tab list, each plan tab tagged with its project

The strip shows every `drafting` plan in the workspace, not only the chat's selected project's. Since
there is no workspace-wide plans endpoint, the client issues one `usePlans(projectId)` query per
project (the workspace has three) and merges the results; each tab carries its plan's project name so
plans from different projects can be told apart. This is the revision captain asked for at plan
review ("one tab for each plan").

**New plan** still creates in the chat composer's project scope (the per-thread draft's `projectId`),
defaulting to the workspace's first project when the scope is `Auto`, exactly as the modal's
`effectiveProjectId` defaulted. Changing the scope changes where the next **New plan** lands and
does not create, discard or re-scope an existing plan. The project is chosen from the weaver tab,
where the composer's scope lives, since a plan tab's composer has no scope selector (as the modal's
did not).

Alternative considered (and first drafted): scope the strip to the chat's project and switch it with
the composer's scope. Rejected — captain asked for a tab per plan, and a strip that hides another
project's plans does not show every one.

### Tabs are the server's drafting-plan list, so persistence is free

`usePlans(projectId)` already returns a project's `drafting` plans newest-first and the app already
invalidates it on `plan.*` events. The strip renders the merged per-project lists, so a reload
re-shows the same tabs and a submitted/discarded plan drops out on its own. The device-remembered
focus moves from a per-project key (`weave:plan:lastTab:<ws>:<projectId>`) to a per-workspace one
(`weave:plan:lastTab:<ws>`), extended with a sentinel for the weaver tab, so switching back to a plan
tab after a reload restores where the human was; when the remembered plan is gone the strip falls
back to another plan or the weaver tab. No new endpoint, no new key store beyond the workspace key
and its sentinel.

### `PlanModal` becomes `PlanTab`; the tab logic moves up to `ChatPage`

The modal's body — the planner conversation, the drafts aside, the draft editor, Submit — is lifted
into a `PlanTab` component for the focused plan, and everything that is modal/chrome goes away: the
overlay and dialog/sheet wrapper, the **Plan** header, the project tag strip and the inner plan tab
list. The list/creation/rename/discard/focus logic moves to `ChatPage` (or a small `usePlanTabs`
hook) so it can drive the strip and the active tab. Reusing the existing conversation components and
plan hooks keeps VS-442 parity structural.

### A plan tab's drafts are an aside on desktop and a switch on phone

The modal's desktop side-by-side and phone Chat/Drafts switch are kept as the plan tab's own layout:
a right-hand drafts aside on a desktop-sized viewport, and a within-tab control switching
conversation/drafts on a phone, so the draft list is never unreachable and the conversation keeps the
shared view's measurement behaviour.

### The composer loses its Plan control

`ChatComposer`'s `onOpenPlan` prop and **Plan** button are removed; the tab strip's **New plan**
replaces the entry point. The composer keeps **Search** and every other control. This is what removes
the "second entry point" ambiguity: one control starts a plan, and it is the strip's.

## Risks / Trade-offs

- [The strip rebases against VS-549, which edits `ChatPage.tsx` and the decisions pane] → keep the
  decisions-pane logic untouched and re-run the UI suite after the rebase; VS-554's `contextStrip`
  factoring, if it lands first, is reused rather than duplicated.
- [A strip row costs vertical space on a phone] → the strip is one 38px row, scrolls horizontally,
  and the **New plan** control is pinned outside the scroller so it can never be pushed off-screen.
- [A workspace-wide strip needs one `usePlans` query per project] → each is the existing query keyed
  by project and already invalidated on `plan.*` events, so a plan created or submitted anywhere
  refreshes the strip without a reload; the workspace has three projects, so the fan-out is small.
- [A plan tab's composer and the weaver composer both listen to the global dictation hotkey] → only
  the focused tab passes `hotkey`/`focused`, as the modal already did with `hotkey={!planOpen}`;
  the same rule becomes `focused={activeTab is this tab}`.
- [Two tabs could hold two live planners] → unchanged from the modal: focusing a tab re-ensures its
  planner and retires the project's idle ones; focusing the weaver tab does not ensure a planner.

## Migration Plan

Pure UI change; no data migration and no daemon change. Landing is the normal merge; rollback is a
revert. The main-spec `Purpose` edits that accompany this change (the `planning-sessions/v2-modal`
and `planning-sessions/storage` and `planning-sessions/scout-dispatch` purposes no longer say
"modal") are part of the same change.

## Open Questions

None.
