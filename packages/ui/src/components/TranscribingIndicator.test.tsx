/**
 * VS-441: the transcribing indicator. It animates on a canvas frame loop while motion is allowed,
 * draws a single static frame under reduced motion, and its label is announced politely.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscribingIndicator } from './TranscribingIndicator';

function fakeCtx(): CanvasRenderingContext2D {
  const noop = (): void => undefined;
  return {
    setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    arcTo: noop, closePath: noop, fill: noop, globalAlpha: 1, fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('TranscribingIndicator (VS-441)', () => {
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

  it('announces "Transcribing…" politely and keeps its canvas out of the accessibility tree', () => {
    render(<TranscribingIndicator className="h-6" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Transcribing…');
    expect(status.querySelector('canvas')?.parentElement).toHaveAttribute('aria-hidden');
  });

  it('animates on a frame loop while motion is allowed', () => {
    const { container } = render(<TranscribingIndicator className="h-6" />);
    expect(frames.length).toBe(1);
    const box = container.querySelector('canvas')!.parentElement as HTMLElement;
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => 200 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 24 });
    const cb = frames.shift();
    cb?.(performance.now());
    // Each frame schedules the next, so the travel keeps moving.
    expect(frames.length).toBe(1);
  });

  it('draws one static frame and schedules nothing under reduced motion', () => {
    render(<TranscribingIndicator className="h-6" reducedMotion />);
    expect(frames.length).toBe(0);
    expect(screen.getByRole('status')).toHaveTextContent('Transcribing…');
  });
});