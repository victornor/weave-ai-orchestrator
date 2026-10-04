## 1. Branch cleanup after merge

- [x] 1.1 Add `deleteBranchAfterMerge` policy + `defaults.deleteBranchAfterMerge` and a resolver in `packages/shared`, with tests
- [x] 1.2 Add optional `deleteBranch`/`listBranches` to `ForgeAdapter` and implement in the gh forge, with tests
- [x] 1.3 Implement the branch-cleanup module (guards, local branch deletion, single ticket note on failure) and call it after `mergeDone` records done; tests for deleted, policy off, default/landing never deleted, uncontained head, failure not failing the landing
- [x] 1.4 Add the project Settings toggle following the existing boolean policy pattern, with UI test
- [x] 1.5 Add the prune route and `weave project prune-branches <project> [--dry-run]`, with tests that dry-run deletes nothing

## 2. Demo mode

- [x] 2.1 Add demo boot mode: refuse port 7433 and the live config dir, skip dispatcher/supervisor/channels/webhooks/push/upgrade, fake forge and runtime adapters
- [x] 2.2 Build the deterministic seed (fixed clock and ids): workspaces, projects, roles, workers in all states, tickets in every status and kind, all decision kinds and review states, plans, PR links, transcripts, usage, incidents, scheduled tasks, roadmap, knowledge, merge queue; test that two seeds are identical
- [x] 2.3 Seed the weaver conversation (ticket chips) and add the scripted live-progress player for the trace and run streams
- [x] 2.4 Add `weave demo` to the CLI
- [x] 2.5 Add the screenshot manifest and `pnpm demo:screenshots` (desktop/phone x light/dark, named PNGs); test that every manifest route renders without errors under the demo daemon
- [ ] 2.6 Generate the screenshots, inspect each, attach to the ticket

## 3. Docs and verification

- [x] 3.1 Document demo mode, regenerating screenshots, extending the manifest, and the branch-cleanup policy and prune command
- [ ] 3.2 Run lint, typecheck and both suites; paste both blocks
