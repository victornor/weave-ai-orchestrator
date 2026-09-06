import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

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

class FakeEventSource {
  close = vi.fn();
  addEventListener = vi.fn();
  onopen: unknown = null;
  onerror: unknown = null;
  onmessage: unknown = null;
}
(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
