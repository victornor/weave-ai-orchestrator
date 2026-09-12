## 1. Safe workspace resolution for the document hooks

- [x] 1.1 Add an optional trailing `wsOverride?: string` to `useTicketDocument` and `useTicketDocumentById` in `packages/ui/src/api/hooks.ts`, resolving `const ws = useHookWs(wsOverride)` exactly as `useProjects`/`useTickets` do; verify the existing hooks tests still pass (`pnpm --filter @weave-ai/ui exec vitest run src/test`).
- [x] 1.2 Confirm `useTicketDocumentRevisions` and every other `useWs()` call site reachable from a daemon-wide route is either already safe or left unchanged, and state the reachable set in the PR description; verify with a transitive walk from each global route component and `AppShell`.

## 2. Thread the workspace into the previews

- [x] 2.1 Add a `ws?: string` prop to `PlanPreview` and pass it to `useTicketDocument`, and pass the card's `ws` from `GlobalNeeds`; verify a plan-approval card renders on `/needs` with no provider.
- [x] 2.2 Add a `ws?: string` prop to `DocumentPreview`, have `DecisionCard` pass its existing `ws` (`?? undefined`) through, and pass the card's `ws` from `GlobalNeeds`; verify a document-targeted decision renders on `/needs` with no provider.
- [x] 2.3 Confirm per-workspace call sites (`Chat.tsx`, `NeedsYou.tsx`, `TicketPage.tsx`, `KnowledgeExplorer.tsx`) need no change because the override falls back to context; verify the existing UI suite for those routes is green.

## 3. Regression guard

- [x] 3.1 Add `packages/ui/src/test/globalNeedsContext.test.tsx` that renders the real `GlobalNeedsRoute` with a real `QueryClientProvider` and no `WorkspaceProvider`, mocks only `../api/client` (not `../api/hooks` or `../api/context`), and includes a `plan_approval` plus a document-targeted decision; verify it fails when `useTicketDocument` is temporarily reverted to `useWs()` and passes with the fix.
- [x] 3.2 In the same test, assert the plan/document requests are issued against the decision's own workspace while a different workspace is remembered in `localStorage`, and that no render error is recorded; verify the assertion fails if `ws` is not threaded through.

## 4. Verification and delivery

- [x] 4.1 Run `pnpm lint && pnpm typecheck` and confirm both are green.
- [x] 4.2 Run `pnpm test` and paste both suite blocks verbatim in the final report; confirm the core and UI suites both pass.
- [x] 4.3 Deliver the branch per `references/delivery.md` and transition the ticket to `in_review` with the pull request recorded as the work product.
