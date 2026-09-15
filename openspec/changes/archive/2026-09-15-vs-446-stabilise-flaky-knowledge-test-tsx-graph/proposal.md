# Stabilise the flaky knowledge graph-tab test

Tracker change for [VS-446](weave://tickets/VS-446). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

VS-438, while stabilising `dictation.test.tsx`, ran a 9-run concurrent-suite stress (3 UI suites × 3
rounds) as a stand-in for the loaded landing slot. Dictation failures went to zero; the one
remaining under-load failure was this pre-existing case:

```
packages/ui/src/test/knowledge.test.tsx > Knowledge — graph tab > does not load the graph renderer until its tab is opened
```

Landing checks run the full suite behind one serial merge slot, so a flake here can fail an approved
PR and stall the queue.

## What was found

Reproduced 2026-09-15: the same 9-run stress fails **7 of 9** runs on this case, each just past the
default cap — 1078 ms, 1103 ms, 1132 ms, 1180 ms, 1418 ms, 1859 ms — against
`findByText`'s 1000 ms default, with the DOM still on the `SkeletonRows` fallback.

The case is not the VS-438 microtask shape. `Knowledge.tsx` renders the graph through
`lazy(() => import('./KnowledgeGraph'))`, and `KnowledgeGraph.tsx` pulls in
`react-force-graph-2d`. The first `import()` of that chunk makes vitest transform and load it on
demand; under a loaded suite that work takes longer than `findByText`'s one-second window, so the
assertion gives up while the import is still in flight. The time is wall-clock module loading, not
a starved poll on already-settled work.

## What changes

- **Stop waiting on the wall clock.** The assertion moves from `findByText` to a shared
  `eventually()` helper that re-runs the assertion, yielding the event loop between attempts, with no
  wall-clock deadline. The helper is extracted to `packages/ui/src/test/eventually.ts` rather than
  copied, per the ticket.
- **The helper yields the event loop, not only microtasks.** The wait is React's Suspense retry for
  the `lazy()` chunk, which the scheduler runs as a macrotask. VS-438's microtask-drain-inside-`act`
  shape spins on that retry, so `eventually` yields a `setTimeout(0)` instead, wrapped in a disabled
  React act environment (as `@testing-library`'s own `waitFor` does) so no "not wrapped in act"
  warning is raised.
- **Preloading the chunk was measured and dropped.** The test file was instrumented: importing
  `KnowledgeGraph` takes ~190 ms the first time and 0 ms once cached, yet the click-to-empty-state
  wait stays ~300 ms with or without a preload. The wait is the Suspense retry, not the module
  transform, so no preload was added.

The behaviour under test is unchanged: the graph component still mounts only when the Graph tab is
opened (`queryByLabelText('Search the graph')` is still null first, and the real empty state still
renders after). Test-only; no product behaviour change. If the flake had shown a real race in the
knowledge graph code, the delivery would say so — it did not.

## Found while proving it (out of scope)

The 3 × 3 stress surfaced the same latent shape in `packages/ui/src/test/globalMap.test.tsx`: its
`draw()` helper waits on the lazy `MapCanvas` chunk with `findByLabelText('Instance map')` and failed
once under load (run 1, round 3). It is a different file and no knowledge feature, so it is not fixed
here; the shared `eventually` helper is ready to adopt there.

## Out of scope

- Dictation tests (VS-438) and any knowledge graph feature change.
