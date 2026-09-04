import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// jsdom has no matchMedia, ResizeObserver or EventSource.
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

class FakeEventSource {
  close = vi.fn();
  addEventListener = vi.fn();
  onopen: unknown = null;
  onerror: unknown = null;
  onmessage: unknown = null;
}
(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
