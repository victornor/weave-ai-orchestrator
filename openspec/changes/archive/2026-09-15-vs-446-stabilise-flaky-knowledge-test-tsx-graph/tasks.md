# Tasks

- [x] 1. Reproduce under the concurrent stress (3 UI suites × 3 rounds): recorded 7/9 runs failing this case at 1078–1859 ms against `findByText`'s 1000 ms cap, DOM still on the `SkeletonRows` fallback.
- [x] 2. Add a shared `eventually(assertion, turns)` to `packages/ui/src/test/eventually.ts`: re-run the assertion, yielding the event loop between attempts with no wall-clock deadline. (Yields a `setTimeout(0)` with React's act environment off, not a microtask drain inside `act` — the Suspense retry is a macrotask and `act` spins on it.)
- [x] 3. `packages/ui/src/test/knowledge.test.tsx`: wait for the graph with `eventually` instead of `findByText`, keeping the lazy-mount behaviour under test. (Preloading the chunk was measured to make no difference to the wait and was dropped.)
- [x] 4. Prove it: `knowledge.test.tsx` alone 20× (20/20), the full UI suite 10× (10/10), and the 3 × 3 concurrent stress 9× (knowledge 0/9 failing); the counts are on the ticket.
- [x] 5. Evidence and checks: `pnpm lint`, `pnpm typecheck` clean; `pnpm test` both blocks green, pasted on the ticket. One out-of-scope `globalMap.test.tsx` flake appeared in the stress and is recorded in the proposal.