/**
 * A visual viewport jsdom can be given, because the case that matters has no other symptom.
 *
 * When a phone keyboard opens, the layout viewport and every element in it stay exactly the size
 * they were; only the region the browser is showing shrinks, and it is announced on
 * `window.visualViewport` alone. jsdom has no such object, so nothing in the suite can reach that
 * path without one.
 *
 * `layoutHeight` stands in for `documentElement.clientHeight`, which jsdom reports as 0 — the
 * measurement is the difference between the two viewports, so both have to be real numbers.
 */

class FakeVisualViewport extends EventTarget {
  width = 390;
  height: number;
  offsetTop = 0;
  offsetLeft = 0;
  pageTop = 0;
  pageLeft = 0;
  scale = 1;

  constructor(height: number) {
    super();
    this.height = height;
  }
}

export interface FakeViewport {
  /** The layout viewport, which a keyboard never changes. */
  readonly layoutHeight: number;
  /** The keyboard opens: what is shown shrinks to `height`, the browser having panned down by `top`. */
  keyboard: (height: number, top?: number) => void;
  /** The keyboard closes. */
  close: () => void;
  /** A pinch-zoom, which shrinks the same numbers and must not be read as a keyboard. */
  zoom: (scale: number) => void;
}

export function installVisualViewport(layoutHeight = 800): FakeViewport {
  const vv = new FakeVisualViewport(layoutHeight);
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => layoutHeight });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  const move = (height: number, top: number, scale: number): void => {
    vv.height = height;
    vv.offsetTop = top;
    vv.scale = scale;
    // Both, as a browser does: the region changes size and the page it sits on is panned under it.
    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
  };
  return {
    layoutHeight,
    keyboard: (height, top = 0) => move(height, top, 1),
    close: () => move(layoutHeight, 0, 1),
    zoom: (scale) => move(Math.round(layoutHeight / scale), 0, scale),
  };
}

export function removeVisualViewport(): void {
  Reflect.deleteProperty(window, 'visualViewport');
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
  const root = document.documentElement;
  root.removeAttribute('data-keyboard');
  for (const prop of ['--ac-app-h', '--ac-app-top', '--ac-app-bottom']) root.style.removeProperty(prop);
}
