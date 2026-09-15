/**
 * Wait for a condition without a wall-clock deadline.
 *
 * `waitFor` (and so `findBy*`) polls against a real-timer timeout, so under a loaded suite a case
 * whose work is merely late can fail its one-second cap — VS-438's dictation uploads and VS-446's
 * lazy graph chunk are both that shape. This re-runs the assertion, yielding the event loop between
 * attempts, so nothing is judged against a stopwatch. The final call re-runs the assertion, so a
 * condition that never becomes true still reports its own failure rather than a bare turn count.
 *
 * The wait runs with React's act environment off, exactly as `@testing-library`'s own `waitFor`
 * does, so an update that lands while we are polling — a `lazy()` chunk's Suspense retry is one —
 * does not warn as "not wrapped in act". `eventually` cannot wrap the loop in `act` itself: a
 * Suspense retry never lets that act call settle, so it spins. Yielding the event loop instead
 * (rather than only draining microtasks) is what lets the retry run, since React schedules it
 * through the scheduler.
 *
 * `turns` is only a guard against a pathological loop, not a functional timeout — a normal run here
 * exits in a couple of hundred turns, well inside vitest's own per-test timeout.
 */
export async function eventually(assertion: () => void, turns = 3000): Promise<void> {
  const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = globals.IS_REACT_ACT_ENVIRONMENT;
  globals.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    for (let i = 0; i < turns; i++) {
      try {
        assertion();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    assertion();
  } finally {
    globals.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}