import { afterEach, describe, expect, it } from 'vitest';
import { applyInsets, readInsets, watchViewport } from '../lib/viewport';
import { installVisualViewport, removeVisualViewport } from './visualViewport';

const root = (): HTMLElement => document.documentElement;
const prop = (name: string): string => root().style.getPropertyValue(name);

afterEach(removeVisualViewport);

describe('reading what the browser is showing', () => {
  it('reports no keyboard when there is no visual viewport to read', () => {
    expect(readInsets().keyboard).toBe(false);
  });

  it('reports the band the keyboard covers', () => {
    const viewport = installVisualViewport(800);
    viewport.keyboard(500);

    expect(readInsets()).toEqual({ height: 500, top: 0, bottom: 300, keyboard: true });
  });

  it('follows the browser rather than fighting it when it has panned the page up', () => {
    // Safari pans the visual viewport to put the focused input on screen. The app is drawn over
    // exactly where it panned to, so nothing below it is covered and there is no position for the
    // two to disagree about.
    const viewport = installVisualViewport(800);
    viewport.keyboard(500, 300);

    expect(readInsets()).toEqual({ height: 500, top: 300, bottom: 0, keyboard: true });
  });

  it('reads a closed keyboard as no keyboard', () => {
    const viewport = installVisualViewport(800);
    viewport.keyboard(500);
    viewport.close();

    expect(readInsets().keyboard).toBe(false);
  });

  it('ignores a difference too small to be a keyboard', () => {
    const viewport = installVisualViewport(800);
    viewport.keyboard(760);

    expect(readInsets().keyboard).toBe(false);
  });

  it('ignores a pinch-zoom, which shrinks the same numbers', () => {
    const viewport = installVisualViewport(800);
    viewport.zoom(2);

    expect(readInsets().keyboard).toBe(false);
  });
});

describe('publishing it to the layout', () => {
  it('sets the properties the layout sizes against, and collapses the safe-area gap', () => {
    applyInsets({ height: 500, top: 40, bottom: 260, keyboard: true });

    expect(prop('--ac-app-h')).toBe('500px');
    expect(prop('--ac-app-top')).toBe('40px');
    expect(prop('--ac-app-bottom')).toBe('260px');
    expect(root().getAttribute('data-keyboard')).toBe('open');
  });

  it('removes them outright when there is no keyboard, so the stylesheet dvh defaults are read', () => {
    applyInsets({ height: 500, top: 0, bottom: 300, keyboard: true });
    applyInsets({ height: 800, top: 0, bottom: 0, keyboard: false });

    expect(prop('--ac-app-h')).toBe('');
    expect(prop('--ac-app-top')).toBe('');
    expect(prop('--ac-app-bottom')).toBe('');
    expect(root().getAttribute('data-keyboard')).toBeNull();
  });
});

describe('watching it', () => {
  it('publishes the keyboard opening and closing, and stops when it is torn down', () => {
    const viewport = installVisualViewport(800);
    const stop = watchViewport();

    expect(prop('--ac-app-h')).toBe('');

    viewport.keyboard(500);
    expect(prop('--ac-app-h')).toBe('500px');
    expect(prop('--ac-app-bottom')).toBe('300px');

    viewport.close();
    expect(prop('--ac-app-h')).toBe('');
    expect(root().getAttribute('data-keyboard')).toBeNull();

    stop();
    viewport.keyboard(500);
    expect(prop('--ac-app-h')).toBe('');
  });

  it('leaves a desktop browser with no overriding pixel height at all', () => {
    watchViewport()();

    expect(prop('--ac-app-h')).toBe('');
    expect(root().getAttribute('data-keyboard')).toBeNull();
  });
});
