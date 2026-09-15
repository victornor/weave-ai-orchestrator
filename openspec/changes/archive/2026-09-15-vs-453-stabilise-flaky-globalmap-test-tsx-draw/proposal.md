# Stabilise the flaky `globalMap.test.tsx` lazy-chunk wait

Tracker change for [VS-453](weave://tickets/VS-453). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

VS-446, while stabilising `knowledge.test.tsx` with a 3 × 3 concurrent-suite stress, surfaced the same
latent shape in `packages/ui/src/test/globalMap.test.tsx`: its `draw()` helper waits on the lazily
loaded `MapCanvas` chunk with `findByLabelText('Instance map')`, and failed once under load (run 1,
round 3) with `Unable to find a label with the text of: Instance map`.

Landing checks run the full suite behind one serial merge slot, so a flake here can fail an approved
PR and stall the queue. VS-446 added the shared `packages/ui/src/test/eventually.ts` helper for
exactly this shape; this change adopts it and sweeps the remaining lazy-chunk waits.

## What was found

`packages/ui/src/routes/GlobalMap.tsx` renders the canvas through
`lazy(async () => ({ default: (await import('./MapCanvas')).MapCanvas }))`. The first `import()` of
that chunk makes vitest transform and load it on demand; a `lazy()` chunk resolves through React's
Suspense retry, which the React scheduler runs as a macrotask. `findBy*` / `waitFor` give up after a
1000 ms real-timer deadline, so under CPU load the retry lands after the cap and the assertion fails
while the fallback is still on screen. The time is wall-clock module loading and scheduling, not a
starved poll on already-settled work.

## What changes

- **Stop waiting on the wall clock.** Every wait on a `lazy()` chunk moves from `find*` / `waitFor`
  to the shared `eventually()` helper (`packages/ui/src/test/eventually.ts`), which re-runs the
  assertion, yielding the event loop between attempts, with no wall-clock deadline. Timeouts are not
  raised.
- **Sweep the remaining lazy chunks.** The four `lazy(...)` chunks in `packages/ui` are `MapCanvas`
  (`routes/GlobalMap.tsx`), `KnowledgeGraphView` (`routes/Knowledge.tsx`, fixed by VS-446) and
  `KnowledgeGraphView` / `KnowledgeExplorer` (the V2 pages in `v2/knowledge/`). The tests that wait on
  each are converted; they are listed in the delivery.
- **Disambiguate the two helpers.** `packages/ui/src/test/dictation.test.tsx` has a *different* local
  `eventually` (VS-438: a microtask drain inside `act` for already-settled work, which VS-446 found
  hangs on a Suspense retry). It is renamed to `settleMicrotasks`, with a note pointing at the shared
  `eventually` for lazy-chunk waits, so the two are not confused.

The behaviour under test is unchanged: the map still draws its nodes only once the canvas chunk
mounts, error/loading/empty states are still asserted, and no product code is touched. Test-only; no
product behaviour change. If the flake had shown a real race in the map code, the delivery would say
so — it did not.

## Out of scope

- Any map feature change, and the dictation/upload waits themselves (VS-438) beyond renaming their
  local helper.