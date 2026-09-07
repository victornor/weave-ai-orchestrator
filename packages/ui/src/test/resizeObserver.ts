/**
 * A ResizeObserver jsdom can be given. jsdom performs no layout, so nothing ever resizes and a real
 * observer would never fire; this one is fired by hand — `resizeObserved()` stands in for the
 * relayout the browser would have done.
 *
 * Installed globally from `setup.ts`, because code that observes an element must not have to know
 * whether it is being tested.
 */

type Callback = ResizeObserverCallback;

const live = new Set<FakeResizeObserver>();

class FakeResizeObserver {
  private readonly callback: Callback;

  constructor(callback: Callback) {
    this.callback = callback;
  }

  observe(): void {
    live.add(this);
  }

  unobserve(): void {
    /* The fake fires per observer, not per element: one target left is still an observer to fire. */
  }

  disconnect(): void {
    live.delete(this);
  }

  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

export function installResizeObserver(): void {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
}

/** Every connected observer fires: the relayout jsdom will never perform on its own. */
export function resizeObserved(): void {
  for (const observer of [...live]) observer.fire();
}

/** Between tests, so a component left over from one is not still observing in the next. */
export function clearResizeObservers(): void {
  live.clear();
}
