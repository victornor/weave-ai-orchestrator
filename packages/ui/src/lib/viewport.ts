/**
 * The region the browser is actually showing, mirrored into CSS custom properties — DESIGN-CONTRACT §3.
 *
 * On a phone the on-screen keyboard does not shrink the layout viewport. By default the browser
 * keeps the page at its full height, shrinks the *visual* viewport and pans it so the focused input
 * is on screen. Everything anchored to the bottom of the layout viewport — the app shell's own
 * height, the fixed tab bar, the composer above it — is therefore still underneath the keyboard, and
 * the next reflow (a message arriving, a decision card pinning) throws the pan away and puts it back
 * there. That is the composer disappearing while a turn streams.
 *
 * `interactive-widget=resizes-content` in the viewport meta asks the browser to shrink the layout
 * viewport instead, which is all Chrome on Android needs: `100dvh` then already excludes the
 * keyboard and nothing here has anything to do. Safari does not support it, so this module reads
 * `visualViewport` and publishes the same geometry as custom properties the layout uses in place of
 * the viewport units:
 *
 * | property          | what it is                                                        |
 * |-------------------|-------------------------------------------------------------------|
 * | `--ac-app-h`      | the height the app may use                                        |
 * | `--ac-app-top`    | its top edge, in layout-viewport coordinates                      |
 * | `--ac-app-bottom` | what the keyboard covers below it, for `position: fixed` elements  |
 *
 * It mirrors rather than fights. Wherever the browser has panned to is where the app is drawn, so
 * the two never disagree about a position and there is nothing for them to oscillate over. When
 * there is no keyboard the properties are removed outright and the stylesheet's `dvh` defaults are
 * what the layout reads — a desktop browser never leaves an overriding pixel value behind.
 */

/** Below this, a difference between the two viewports is browser chrome or rounding, not a keyboard. */
export const KEYBOARD_MIN_PX = 60;

export interface ViewportInsets {
  /** The visible height, in px. */
  height: number;
  /** Its top edge in layout-viewport coordinates: how far the browser has panned. */
  top: number;
  /** The band below it the keyboard covers. */
  bottom: number;
  /** False when the two viewports agree, and the stylesheet's own `dvh` sizing is correct. */
  keyboard: boolean;
}

/**
 * What the browser is showing right now. `win` is a parameter so the measurement can be tested
 * against a viewport that jsdom has no way to produce.
 */
export function readInsets(win: Window = window): ViewportInsets {
  const layout = win.document.documentElement.clientHeight;
  const none: ViewportInsets = { height: layout, top: 0, bottom: 0, keyboard: false };
  const vv = win.visualViewport;
  // A pinch-zoom shrinks the visual viewport too, and a zoomed page is meant to stay the size it
  // was — shrinking the app to the magnified region would take the rest of it away from them.
  if (!vv || vv.scale > 1.01) return none;
  const top = Math.max(0, Math.round(vv.offsetTop));
  const height = Math.round(vv.height);
  const bottom = Math.max(0, layout - top - height);
  if (top + bottom < KEYBOARD_MIN_PX) return none;
  return { height, top, bottom, keyboard: true };
}

/** Publish `insets` as custom properties on `root`, or clear them when there is no keyboard. */
export function applyInsets(insets: ViewportInsets, root: HTMLElement = document.documentElement): void {
  if (!insets.keyboard) {
    root.style.removeProperty('--ac-app-h');
    root.style.removeProperty('--ac-app-top');
    root.style.removeProperty('--ac-app-bottom');
    root.removeAttribute('data-keyboard');
    return;
  }
  root.style.setProperty('--ac-app-h', `${insets.height}px`);
  root.style.setProperty('--ac-app-top', `${insets.top}px`);
  root.style.setProperty('--ac-app-bottom', `${insets.bottom}px`);
  // The home indicator is under the keyboard while it is open, so the safe-area gap the bar holds
  // for it is dead space then; `--ac-safe-bottom` collapses on this attribute.
  root.setAttribute('data-keyboard', 'open');
}

export function isSameInsets(a: ViewportInsets | null, b: ViewportInsets): boolean {
  return a !== null && a.height === b.height && a.top === b.top && a.bottom === b.bottom && a.keyboard === b.keyboard;
}

/**
 * Keep the properties in step with the viewport for as long as the app is open. Published
 * synchronously: the events come from the keyboard's own animation, and a frame's delay is a frame
 * of the composer sitting in the wrong place. Repeats are dropped instead — `visualViewport` fires
 * `scroll` far more often than the geometry actually changes.
 */
export function watchViewport(win: Window = window): () => void {
  const vv = win.visualViewport;
  let last: ViewportInsets | null = null;
  const publish = (): void => {
    const next = readInsets(win);
    if (isSameInsets(last, next)) return;
    last = next;
    applyInsets(next, win.document.documentElement);
  };
  publish();
  vv?.addEventListener('resize', publish);
  vv?.addEventListener('scroll', publish);
  win.addEventListener('orientationchange', publish);
  return () => {
    vv?.removeEventListener('resize', publish);
    vv?.removeEventListener('scroll', publish);
    win.removeEventListener('orientationchange', publish);
  };
}
