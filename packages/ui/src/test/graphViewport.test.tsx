import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  centreOn,
  clampZoom,
  DEFAULT_ZOOM,
  defaultView,
  fitTo,
  labelDetail,
  LABEL_FULL_ZOOM,
  LABEL_TRUNCATED_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  midpoint,
  panBy,
  pinchScale,
  toGraph,
  zoomAround,
  type ViewportTransform,
} from '../lib/graph/viewport';

const SIZE = { width: 800, height: 500 };

describe('zoomAround', () => {
  it('keeps the point under the pointer under the pointer', () => {
    const before: ViewportTransform = { k: 1.3, x: -40, y: 22 };
    const at = { x: 310, y: 180 };
    const under = toGraph(before, at);

    const after = zoomAround(before, at, 1.6);

    expect(after.k).toBeCloseTo(1.3 * 1.6, 10);
    const stillUnder = toGraph(after, at);
    expect(stillUnder.x).toBeCloseTo(under.x, 8);
    expect(stillUnder.y).toBeCloseTo(under.y, 8);
  });

  it('stops at the zoom bounds instead of running past them', () => {
    let t: ViewportTransform = { k: 1, x: 0, y: 0 };
    for (let i = 0; i < 40; i++) t = zoomAround(t, { x: 100, y: 100 }, 1.4);
    expect(t.k).toBe(MAX_ZOOM);

    for (let i = 0; i < 80; i++) t = zoomAround(t, { x: 100, y: 100 }, 1 / 1.4);
    expect(t.k).toBe(MIN_ZOOM);
  });

  it('clamps a scale on its own', () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });
});

describe('panBy', () => {
  it('translates without changing the zoom', () => {
    expect(panBy({ k: 2, x: 10, y: 10 }, 15, -5)).toEqual({ k: 2, x: 25, y: 5 });
  });
});

describe('pinchScale', () => {
  it('is the ratio of the distance between the fingers', () => {
    const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }] as const;
    const to = [{ x: 0, y: 0 }, { x: 250, y: 0 }] as const;
    expect(pinchScale(from, to)).toBeCloseTo(2.5, 10);
  });

  it('is 1 when the fingers started on top of each other', () => {
    const same = [{ x: 5, y: 5 }, { x: 5, y: 5 }] as const;
    expect(pinchScale(same, [{ x: 0, y: 0 }, { x: 50, y: 0 }])).toBe(1);
  });

  it('zooms about the midpoint between the fingers', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 300, y: 100 };
    expect(midpoint(a, b)).toEqual({ x: 200, y: 100 });
  });
});

describe('fitTo', () => {
  it('frames the bounds inside the viewport with a margin', () => {
    const bounds = { minX: -200, minY: -100, maxX: 200, maxY: 100 };
    const t = fitTo(bounds, SIZE, 40);

    for (const p of [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
    ]) {
      const screen = { x: p.x * t.k + t.x, y: p.y * t.k + t.y };
      expect(screen.x).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(screen.x).toBeLessThanOrEqual(SIZE.width - 40 + 1e-6);
      expect(screen.y).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(screen.y).toBeLessThanOrEqual(SIZE.height - 40 + 1e-6);
    }
  });

  it('centres what it frames', () => {
    const t = fitTo({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, SIZE, 40);
    expect(50 * t.k + t.x).toBeCloseTo(SIZE.width / 2, 8);
    expect(50 * t.k + t.y).toBeCloseTo(SIZE.height / 2, 8);
  });

  it('keeps the fitted zoom inside the bounds for a single point', () => {
    const t = fitTo({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, SIZE, 40);
    expect(t.k).toBeLessThanOrEqual(MAX_ZOOM);
    expect(t.k).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
});

describe('defaultView', () => {
  it('floors zoom at DEFAULT_ZOOM for a graph larger than the frame', () => {
    const t = defaultView({ minX: 0, minY: 0, maxX: 4000, maxY: 3000 }, SIZE, 40);
    expect(t.k).toBe(DEFAULT_ZOOM);
    expect(2000 * t.k + t.x).toBeCloseTo(SIZE.width / 2, 8);
    expect(1500 * t.k + t.y).toBeCloseTo(SIZE.height / 2, 8);
  });

  it('keeps the higher fitted zoom when the graph already fits', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 };
    const fitted = fitTo(bounds, SIZE, 40);
    const t = defaultView(bounds, SIZE, 40);
    expect(fitted.k).toBeGreaterThan(DEFAULT_ZOOM);
    expect(t.k).toBe(fitted.k);
    expect(50 * t.k + t.x).toBeCloseTo(SIZE.width / 2, 8);
  });
});

describe('boundsOf and centreOn', () => {
  it('is null for no points', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('brings a point to the middle of the viewport at the current zoom', () => {
    const t = centreOn({ k: 2, x: 0, y: 0 }, { x: 120, y: 40 }, SIZE);
    expect(t.k).toBe(2);
    expect(120 * t.k + t.x).toBeCloseTo(SIZE.width / 2, 8);
    expect(40 * t.k + t.y).toBeCloseTo(SIZE.height / 2, 8);
  });
});

describe('labelDetail', () => {
  it('switches at the thresholds', () => {
    expect(labelDetail(LABEL_TRUNCATED_ZOOM - 0.01)).toBe('none');
    expect(labelDetail(LABEL_TRUNCATED_ZOOM)).toBe('truncated');
    expect(labelDetail(LABEL_FULL_ZOOM - 0.01)).toBe('truncated');
    expect(labelDetail(LABEL_FULL_ZOOM)).toBe('full');
    expect(labelDetail(MAX_ZOOM)).toBe('full');
  });
});
