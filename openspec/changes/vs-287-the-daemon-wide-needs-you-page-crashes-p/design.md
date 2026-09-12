## Context

See `proposal.md` — Why. The relevant facts:

- Global routes are mounted at the router root, outside `/w/$ws`, and have no `WorkspaceProvider`
  (`router.tsx`). `useWorkspace()` throws `useWorkspace outside WorkspaceProvider`; `useWs()` is a
  thin wrapper over it. `useHookWs(override?)` is the safe accessor: `override ?? ctx?.ws ?? ''`.
- `GlobalNeeds` renders a `DecisionCard` per decision and passes it `ws` already. `DecisionCard`
  renders `plan` (a `PlanPreview` element) for `plan_approval` cards and, for a decision with a
  document target, `DocumentPreview`.
- `PlanPreview` and `DocumentPreview` call `useTicketDocument` / `useTicketDocumentById`
  unconditionally at the top of the component, before their own null guards, per React's rule; both
  hooks still call `useWs()`. These are the only two exported hooks in `hooks.ts` that are reachable
  from a daemon-wide route and still unguarded (verified by transitive walk from every global route
  and `AppShell`).
- The existing `test/globalChrome.test.tsx` renders `AppShell` with a stub body, and
  `test/globalNeeds.test.tsx` mocks `../api/hooks` and `../api/context` wholesale, so neither can
  catch a real hook reaching for the missing provider.

## Goals / Non-Goals

**Goals:**

- The daemon-wide Needs you page renders plan-approval and document-targeted cards with no
  `WorkspaceProvider`, reading each preview from the decision's own workspace.
- A regression test that fails when a real hook reachable from that page starts requiring the
  provider.
- The narrowest change that satisfies this; per-workspace rendering and the safe hooks are
  untouched.

**Non-Goals:**

- Changing what `useWs()` does. It keeps throwing.
- Converting `useWs()` call sites no daemon-wide route can reach (`useTicketDocumentRevisions`, the
  rest of `hooks.ts`).
- Any redesign of the Needs you page, or the weaver-chat split view.
- Server, API or data-model changes.

## Decisions

### Decision: an explicit workspace override on the two document hooks, resolved by `useHookWs`

`useTicketDocument(id, key, revision?, wsOverride?)` and
`useTicketDocumentById(id, documentId, revision?, wsOverride?)` resolve `const ws = useHookWs(wsOverride)`,
matching `useProjects(wsOverride?)` and `useTickets(params, { ws })`. The trailing optional parameter
is the least disruptive to the existing positional signatures and their call sites (`TicketPage`,
`KnowledgeExplorer`), none of which change.

Alternative considered: an options object (`{ ws }`) as the last parameter — more extensible, but it
reads oddly beside the existing `revision` positional and the file's established convention is a
plain override argument. Alternative: change `useWs()` to return `''` when there is no provider —
rejected; see the proposal and the risk below.

### Decision: thread the workspace through props rather than read it from context

`PlanPreview` gains `ws?: string`; `GlobalNeeds` already has the card's `ws` and passes it. `DecisionCard`
already receives `ws` (for the handover hook and links); it passes it to `DocumentPreview`, which
gains `ws?: string`. Under a provider the prop is absent and the hooks fall back to context, so chat
and per-workspace Needs you need no change. `ws` on `DecisionCard` is `string | null | undefined`, so
callers narrow with `?? undefined` to satisfy the prop.

Alternatives: wrap each global card in a `WorkspaceProvider` (rejected: it would start an
`EventStream` per card and rewrite the remembered workspace — `remember={false}` would still be a
large behavioural change for a rendering bug); make the preview components read the decision's
`workspaceId` directly (rejected: the decision payload's workspace field is not what the hooks use,
and threading the workspace already in hand is simpler and uniform with the sibling hooks).

### Decision: leave `useTicketDocumentRevisions` and the other `useWs()` sites alone

The ticket calls this out and the reachability analysis confirms no global route reaches
`useTicketDocumentRevisions`, `useTicketDocument`'s other caller (`TicketPage`) or the rest of the
file. Converting them would churn the diff without changing any reachable behaviour.

### Decision: the guard test

Add `packages/ui/src/test/globalNeedsContext.test.tsx` (a new file, because vitest mocks are
per-file and the existing file must keep its hook mocks for its behaviour tests). It:

- mocks only `../api/client` (spread the real module, override `api.ws`/`api.root` with fixed data),
  plus the peripheral `../app/link`, toast, queue and router mocks the existing global-Needs test
  uses — and **not** `../api/hooks` or `../api/context`;
- seeds two workspaces, a `plan_approval` with a plan document in one, and a decision carrying a
  document target; records every `api.ws` call;
- renders `GlobalNeedsRoute` inside a real `QueryClientProvider` and a small error boundary that
  records any thrown error;
- asserts the cards render, no error was recorded, and the plan/document requests used the decision's
  own workspace even with a different workspace remembered in `localStorage`;
- keeps the real `useWorkspace` throwing, so a future unguarded hook in the subtree fails the test
  through the error boundary rather than slipping through.

Alternative considered: extend `globalChrome.test.tsx` — impossible without dropping its hook mocks,
which its other assertions depend on.

## Risks / Trade-offs

- [A future global route uses a different unguarded hook] → the same reachability analysis pattern is
  the checklist; the test guards the page, not the whole app, which matches the ticket's scope.
- [The new test could pass while a hook is accidentally also provided by a mock] → it deliberately
  keeps `../api/context` real, so `useWorkspace` still throws; the error-boundary assertion is the
  tripwire.
- [Adding `ws` to `DecisionCard`'s `DocumentPreview` call site could regress the workspace route] →
  the prop is optional and falls back to `useHookWs`; existing DocumentPreview/DecisionCard tests
  continue to pass unchanged.
- [Silently returning `''` from `useWs()` would hide the next instance] → not done; `useWs` keeps
  throwing and the guard test is the intended detector.

## Migration Plan

UI-only, no data model or API change. Ships in the next built web app with a normal merge. No
rollback steps beyond reverting the commit; the previous release remains on the `previous` symlink.
