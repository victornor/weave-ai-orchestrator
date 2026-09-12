import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { clearResizeObservers, installResizeObserver } from './resizeObserver';

afterEach(cleanup);

// jsdom performs no layout, so it ships no ResizeObserver. Anything that watches an element's size
// gets this one; a test that needs it to fire calls `resizeObserved()`.
installResizeObserver();
afterEach(clearResizeObservers);

// jsdom has no matchMedia, ResizeObserver, EventSource or (on an opaque origin) localStorage.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
  });
}

// Composer drafts live in sessionStorage; one test's draft must not be the next test's opening state.
afterEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* no store in this environment */
  }
});

if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom has no PointerEvent either, so `fireEvent.pointerDown` falls back to a plain Event and every
// `pointerId` arrives undefined — which makes two fingers indistinguishable from one. The knowledge
// graph's pinch and drag handling is keyed on that id.
if (!window.PointerEvent) {
  class FakePointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = FakePointerEvent as unknown as typeof window.PointerEvent;
}

// jsdom has no DOMMatrixReadOnly, which @xyflow/react's internal `updateNodeInternals` (run from
// its own ResizeObserver callback, so any test that fires `resizeObserved()` on a React Flow-based
// page reaches it) parses out of the viewport's own `transform` CSS to read the current zoom. React
// Flow only ever writes that string as `translate(Xpx,Ypx) scale(Z)` (`toTransformString`), so a
// narrow parser for exactly that shape is enough — this is not a general CSS matrix implementation.
if (!window.DOMMatrixReadOnly) {
  class FakeDOMMatrixReadOnly {
    readonly m22: number;
    constructor(transform = '') {
      const m = /scale\(([\d.]+)\)/.exec(transform);
      this.m22 = m?.[1] ? Number(m[1]) : 1;
    }
  }
  window.DOMMatrixReadOnly = FakeDOMMatrixReadOnly as unknown as typeof DOMMatrixReadOnly;
}

class FakeEventSource {
  close = vi.fn();
  addEventListener = vi.fn();
  onopen: unknown = null;
  onerror: unknown = null;
  onmessage: unknown = null;
}
(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
