## Why

The daemon-wide Needs you page (`/needs`) crashes with `useWorkspace outside WorkspaceProvider` as
soon as it renders its first card. Global routes deliberately mount no `WorkspaceProvider`, but
`PlanPreview` (passed unconditionally as the `plan` slot of every card) and `DocumentPreview` (the
general document preview) call `useTicketDocument` / `useTicketDocumentById`, which still reach for
that missing provider. The page is therefore broken in the running release and at HEAD for any
decision row — every card kind, not only plan approvals. The pending daemon upgrade will not fix it.

## What Changes

- Give `useTicketDocument` and `useTicketDocumentById` an explicit workspace override, resolved
  through `useHookWs` like the sibling hooks already are (`useProjects`, `useTickets`,
  `useDecisions`). Under a provider the override is unused and behaviour is unchanged.
- Give `PlanPreview` a `ws` prop and `DocumentPreview` a `ws` prop, and thread them from the caller:
  `GlobalNeeds` already has the card's `ws` and passes it to `DecisionCard`, which already holds it
  and can hand it to `DocumentPreview`.
- Keep `useWs()` throwing. A silent empty-string fallback would turn a missed prop into a
  permanently disabled query, which hides the next instance instead of surfacing it; the narrow fix
  plus the regression test is preferred over a broad change that makes the failure invisible.
- Replace the missing regression guard with a test that mounts the real global Needs page and its
  real hooks with no `WorkspaceProvider` (mocking only the HTTP client, never `../api/hooks` or
  `../api/context`), with at least one `plan_approval` and one document-targeted decision, and fails
  if any hook in that subtree reaches for the provider.
- Deliberately **not** converted: `useTicketDocumentRevisions` and the remaining `useWs()` call
  sites, because no daemon-wide route can reach them and churning them makes the diff unreviewable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `human-decisions/global-needs`: the page must render its cards — including the plan and document
  previews — without a `WorkspaceProvider`, reading each preview from the workspace the card belongs
  to rather than the last-visited one, and this must be guarded by a test.

## Impact

- `packages/ui/src/api/hooks.ts` — `useTicketDocument`, `useTicketDocumentById` gain an optional
  workspace override.
- `packages/ui/src/components/PlanPreview.tsx`, `packages/ui/src/components/DocumentPreview.tsx` —
  a `ws` prop.
- `packages/ui/src/components/DecisionCard.tsx` — pass its existing `ws` into `DocumentPreview`.
- `packages/ui/src/routes/GlobalNeeds.tsx` — pass the card's workspace into `PlanPreview`.
- `packages/ui/src/test/` — a new global Needs test that mounts the real page with no provider.
- No server, API, database, or dependency changes. Per-workspace Needs you and chat are unchanged.
