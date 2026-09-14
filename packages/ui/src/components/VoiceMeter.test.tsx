/**
 * VS-431: the dictation meter must never let its backing store drive its layout. The canvas's
 * `width`/`height` attributes are presentational hints for its CSS size, so measuring the canvas
 * would read back the value the previous frame wrote and grow it every frame — the bug captain saw
 * in the Plan modal. The loop measures its sized box, and the canvas is 100% of that box.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceMeter } from './VoiceMeter';

function fakeCtx(): CanvasRenderingContext2D {
  const noop = (): void => undefined;
  return {
    setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    arcTo: noop, closePath: noop, fill: noop, globalAlpha: 1, fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('VoiceMeter (VS-431)', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('devicePixelRatio', 2);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Drive the scheduled frames synchronously, returning the backing width after each. */
  function runFrames(count: number, canvas: HTMLCanvasElement): number[] {
    const widths: number[] = [];
    for (let i = 0; i < count; i++) {
      const cb = frames.shift();
      if (!cb) break;
      cb(performance.now());
      widths.push(canvas.width);
    }
    return widths;
  }

  it('keeps the backing size fixed across frames when devicePixelRatio is 2', () => {
    const { container } = render(<VoiceMeter analyser={{ current: null }} active className="h-6 min-w-0 flex-1" />);
    const box = container.firstElementChild as HTMLElement;
    const canvas = container.querySelector('canvas')!;
    // The box is the laid-out element, at a fixed size; the canvas has no intrinsic size of its own.
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => 200 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 24 });
    // If the loop measured the canvas, this getter would return the value it just wrote and the
    // size would double every frame — exactly the feedback that broke the modal.
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => canvas.width });

    const widths = runFrames(8, canvas);

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(48);
    expect(new Set(widths)).toEqual(new Set([400]));
  });

  it('lets its box carry the sizing classes and gives the canvas an explicit 100% size', () => {
    const { container } = render(<VoiceMeter analyser={{ current: null }} active className="h-6 min-w-0 flex-1" />);
    const box = container.firstElementChild as HTMLElement;
    const canvas = container.querySelector('canvas')!;
    expect(box.className).toContain('h-6');
    expect(box.className).toContain('min-w-0');
    expect(box.className).toContain('flex-1');
    expect(canvas.className).toMatch(/\bblock\b/);
    expect(canvas.className).toMatch(/\bw-full\b/);
    expect(canvas.className).toMatch(/\bh-full\b/);
  });
});
