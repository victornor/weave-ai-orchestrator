# Move the planning agent from its modal into a tab in the weaver chat

A `change` ticket in project `agent-conductor` ([VS-556](weave://tickets/VS-556)).

## Why

The planning agent lives in a modal that must be opened, used and dismissed before captain can get
back to the weaver. A plan is a body of work drafted over many turns, so it reads as a second
conversation captain is having, not a dialog interrupting the first one — yet today it is modal,
which hides the weaver while it is open and forces every plan into the same overlay. Captain asked
(2026-09-18) to make plans tabs beside the weaver conversation instead.

## What Changes

- **The weaver chat is a tab.** The V2 chat screen gains a tab strip at its top. The weaver
  conversation is the first tab, selected by default, and renders exactly as it does today.
- **A plan is a tab.** Every `drafting` plan in the workspace gets its own tab beside the weaver tab,
  titled from the plan and tagged with its project so plans from different projects can be told
  apart. Several plan tabs can sit open at once beside the weaver tab.
- **A `New plan` control starts one.** A small **New plan** control (a `+`) at the end of the tab
  strip creates a fresh drafting plan in the chat's selected project, opens it as a tab, and focuses
  it with an empty planner conversation. No modal is involved.
- **The Plan modal is removed.** `PlanModal` goes away. Everything it does today moves into a plan
  tab: the planner conversation (rendered through the same shared conversation view, composer and
  attachments as the weaver chat), the live draft list with per-draft edit, reorder, tier override,
  scout dispatch and dispatch state, the Submit action, tab rename and tab delete. Nothing is lost.
- **The entry point moves off the composer.** The composer's **Plan** button is removed; the tab
  strip's **New plan** is the entry point. A plan tab's composer is bound to the plan's project and
  offers no project selector, as the modal's composer did; the chat's own project scope in the weaver
  composer selects which project a new plan belongs to, replacing the modal's own project tag strip.
  It does not filter the strip — the strip shows every project's drafting plans.
- **There is no workspace-wide plans list, and none is added.** The client issues one existing
  `usePlans(projectId)` query per project and merges the results (the workspace has three projects);
  each tab renders its plan's project name.
- **Open tabs survive a reload.** The tab set is every project's server-side `drafting` plans, so a
  reload re-shows the same tabs; the device-remembered last-focused tab (stored per workspace) is
  extended with a sentinel for the weaver tab and re-selects the same one. Submitting a plan removes
  it from the drafting list, so its tab closes; deleting a tab discards its plan after a confirm, as
  today.
- **Narrow screens do not overflow.** The tab strip scrolls horizontally and never wraps or pushes
  the New plan control off-screen; on phone the plan's draft list is reachable through a toggle, as
  the modal's phone sheet did.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/chat`: the chat screen gains a tab strip — the weaver conversation as a tab, one tab per
  drafting plan in the workspace (each tagged with its project), a New plan control, horizontal
  scrolling at narrow widths, and open plan tabs surviving a reload.
- `planning-sessions/v2-modal`: the planning surface is a plan tab inside the weaver chat rather than
  a modal/sheet; its entry point is the tab strip's New plan control; the planner conversation is the
  shared chat conversation and the draft list and Submit live in the tab; tabs span every project;
  New plan is created in the chat's selected project; the modal-specific project picker and overlay
  requirements are removed; the remembered focus is per workspace.
- `web-v2/chat-composer`: the composer no longer carries the Plan control, and the dictation-meter
  host guarantee names the plan tab rather than the removed Plan modal.
- `planning-sessions/storage`: the plan-persistence requirement is reworded from the planning modal
  to the chat and its tabs; the persistence behavior itself is unchanged.

## Impact

- `packages/ui/src/v2/ChatPage.tsx` — owns the tab strip, which tab is focused, and renders the
  active tab; merges one existing `usePlans(projectId)` query per project for a workspace-wide tab
  set with each tab's project name; the weaver tab keeps today's conversation, status bar, decisions
  pane and composer.
- `packages/ui/src/v2/PlanModal.tsx` — replaced by a plan-tab surface (the planner conversation plus
  the draft pane) with no overlay chrome, no project tag strip and no inner tab list; reuses
  `ChatConversation`, `ChatComposer`, the plan hooks and the existing draft editor markup.
- `packages/ui/src/v2/ChatComposer.tsx` — drops `onOpenPlan` and its Plan button.
- `packages/ui/src/test/v2planmodal.test.tsx` — becomes the plan-tab test; `v2chat.test.tsx` and any
  suite that mounts `ChatPage` gain the tab-strip behaviour.
- No server, API, schema or daemon change: the plans list, plan read, drafts, submit and discard
  routes are used exactly as the modal uses them; tab persistence is the existing server-side
  `drafting`-plan list plus the existing device-remembered focus.
- Sibling tickets in the same UI-polish block touch `ChatPage.tsx` and the decisions pane
  ([VS-549](weave://tickets/VS-549)) and may factor the context strip
  ([VS-554](weave://tickets/VS-554)); their behaviour is kept when this branch rebases onto them.
