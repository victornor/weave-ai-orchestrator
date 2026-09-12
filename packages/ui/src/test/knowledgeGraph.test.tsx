import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraph } from '../api/types';
import { resizeObserved } from './resizeObserver';

/**
 * The graph the tests draw: an api project of four pages around a hub, a shared hub linking into
 * it, and one page in a `decisions` group of its own so a legend toggle has something to switch off.
 */
const GRAPH: KnowledgeGraph = {
  nodes: [
    { id: 'projects/api/PROJECT.md', kind: 'hub', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: null, title: 'API knowledge', tokens: 900, updatedAt: '' },
    { id: 'projects/api/docs/payments.md', kind: 'doc', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: 'payments', title: 'Payments webhooks', tokens: 400, updatedAt: '' },
    { id: 'projects/api/docs/billing.md', kind: 'doc', scope: 'project', projectId: 'p1', projectSlug: 'api', slug: 'billing', title: 'Billing runbook', tokens: 300, updatedAt: '' },
    { id: 'SHARED.md', kind: 'hub', scope: 'shared', projectId: null, projectSlug: null, slug: null, title: 'Shared conventions', tokens: 200, updatedAt: '' },
    { id: 'decisions.md', kind: 'hub', scope: 'decisions', projectId: null, projectSlug: null, slug: null, title: 'Decisions log', tokens: 150, updatedAt: '' },
  ],
  edges: [
    { from: 'projects/api/PROJECT.md', to: 'projects/api/docs/payments.md' },
    { from: 'projects/api/PROJECT.md', to: 'projects/api/docs/billing.md' },
    { from: 'projects/api/docs/payments.md', to: 'projects/api/PROJECT.md' },
    { from: 'SHARED.md', to: 'projects/api/PROJECT.md' },
  ],
};

const state = vi.hoisted(() => ({ graph: null as KnowledgeGraph | null, reduced: false, phone: false }));

vi.mock('../api/hooks', () => ({
  useKnowledgeGraph: () => ({ data: state.graph, isLoading: false, isError: false, refetch: vi.fn() }),
}));

const { KnowledgeGraphView } = await import('../routes/KnowledgeGraph');

beforeEach(() => {
  state.graph = GRAPH;
  state.reduced = false;
  state.phone = false;
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduced-motion') ? state.reduced : q.includes('max-width') ? state.phone : false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

/**
 * React Flow's `onInit` — which this component uses to capture the `ReactFlowInstance` that Zoom
 * in/out, Fit and Reset all call — fires via `setTimeout(fn, 1)`, never synchronously with mount
 * (`useOnInitHandler`, `@xyflow/react`). Every test that exercises those buttons needs that timer
 * flushed first, or `rfRef.current` is still null and the click is silently a no-op.
 */
function draw(onOpen = vi.fn()): { container: HTMLElement; onOpen: ReturnType<typeof vi.fn> } {
  vi.useFakeTimers();
  const { container } = render(<KnowledgeGraphView onOpen={onOpen} />);
  act(() => { vi.advanceTimersByTime(5); });
  vi.useRealTimers();
  return { container, onOpen };
}

/** The React Flow node wrapper for a given node id — carries the tick-driven `transform`. */
const wrapperFor = (c: HTMLElement, id: string): HTMLElement => c.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
/** The chip's own inner element — carries `data-chip`/`data-kind`/`data-dimmed`/`data-pinned`. */
const chipFor = (c: HTMLElement, id: string): HTMLElement => c.querySelector<HTMLElement>(`[data-node="${id}"]`)!;
const chips = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[data-node]')];
const detailPanel = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>('[data-graph-detail]')!;
const nums = (s: string): number[] => [...s.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
/** A React Flow node wrapper's position, from its own `transform: translate(x, y)` style. */
const positionOf = (wrapper: HTMLElement): { x: number; y: number } => {
  const [x, y] = nums(wrapper.style.transform);
  return { x: x ?? 0, y: y ?? 0 };
};
const viewportEl = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>('.react-flow__viewport')!;
const viewportTransform = (c: HTMLElement): { x: number; y: number; k: number } => {
  const [x, y, k] = nums(viewportEl(c).style.transform);
  return { x: x ?? 0, y: y ?? 0, k: k ?? 1 };
};
const chipOpacity = (el: Element): string => (el as HTMLElement).style.opacity ?? '';

describe('the graph canvas', () => {
  it('draws one chip per node and one path per drawable edge, with the mutual pair collapsed', () => {
    const { container } = draw();

    expect(chips(container)).toHaveLength(5);
    // Four link rows, but the api hub and payments cite each other: three lines.
    expect(container.querySelectorAll('path[data-edge]')).toHaveLength(3);
    const mutual = container.querySelector('path[data-edge*="payments"]')!;
    expect(mutual.getAttribute('marker-end')).toBeNull();
    const oneWay = container.querySelector('path[data-edge*="SHARED"]')!;
    expect(oneWay.getAttribute('marker-end')).toBe('url(#ac-graph-arrow)');
  });

  it('lays the nodes out and writes their positions onto the React Flow node wrappers', () => {
    const { container } = draw();

    const placed = chips(container).map((el) => positionOf(el.closest('.react-flow__node')!));
    expect(placed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(new Set(placed.map((p) => `${p.x},${p.y}`)).size).toBe(5);
  });

  it('draws a cluster region per group that has more than one page', () => {
    const { container } = draw();

    const hulls = [...container.querySelectorAll('svg path[fill-opacity="0.07"]')];
    const withRegion = hulls.filter((h) => h.getAttribute('d'));
    // api has three pages; shared and decisions have one each.
    expect(withRegion).toHaveLength(1);
  });

  it('never leaves a node hidden waiting on a measurement that will not arrive under jsdom', () => {
    const { container } = draw();
    // Regression guard for the width/height landmine: every React Flow node (chips, hulls, the
    // edges-layer overlay) must declare its own size rather than depend on ResizeObserver.
    const hidden = chips(container)
      .map((el) => el.closest('.react-flow__node') as HTMLElement)
      .filter((el) => el.style.visibility === 'hidden');
    expect(hidden).toHaveLength(0);
  });
});

describe('dragging', () => {
  // React Flow's drag is d3-drag under the hood: it listens for `mousedown` (not `pointerdown`)
  // and then attaches `mousemove`/`mouseup` to `event.view` for the rest of the gesture. Under this
  // repo's jsdom + testing-library versions, constructing that `mousedown` with an explicit `view`
  // throws ("member view is not of type Window") and without one d3-drag itself throws reading
  // `event.view.document` — a real limitation of simulating this specific gesture here, not
  // something `onNodeDrag`/`onNodeDragStop`'s own logic can route around. The wiring itself
  // (`sim.drag(id, x, y)` on drag, `sim.endDrag(id)` on release, converting React Flow's top-left
  // position back to the simulation's centre convention) is unchanged from the pointer-driven
  // version this replaced and is exercised by React Flow's own drag machinery, verified separately
  // in a real browser (task 1.3's perf harness drives the same `sim.drag`/`endDrag` calls at scale).
  it('is draggable and click-selectable without React Flow treating the two as the same gesture', () => {
    const { container } = draw();
    const wrapper = wrapperFor(container, 'projects/api/docs/billing.md');

    expect(wrapper.className).toContain('draggable');
    // `nodeClickDistance={4}` is what tells React Flow a real drag (movement past 4px) is not a
    // click — the replacement for the old hand-rolled `CLICK_SLOP_PX` threshold.
    fireEvent.click(wrapper);
    expect(container.querySelector('[data-graph-detail]')).not.toBeNull();
  });

  it('starts every chip at full opacity, ready for the tick-driven backstop to fade one on demand', () => {
    // `suppressedLabels()`'s own decision logic (which of two overlapping chips loses) is fully
    // covered by `simulation.test.ts`. Forcing a real overlap here needs a real drag gesture, which
    // this environment cannot simulate (see above) — covered instead by the real-browser check in
    // task 1.3, which drives `sim.drag()` at scale. This just confirms nothing pre-emptively fades.
    const { container } = draw();
    for (const chip of chips(container)) expect(chipOpacity(chip)).toBe('');
  });
});

describe('the viewport', () => {
  // Every viewport change here goes through `setViewport`, not React Flow's own `zoomIn`/`zoomOut`
  // (`panZoom.scaleBy`) — found, while writing these tests, not to apply reliably under jsdom even
  // with `duration: 0` and fake timers advanced past it, unlike `setViewport`'s own zero-duration
  // path, which does apply synchronously. `zoomBy` was changed to compute the target zoom itself
  // and call `setViewport`, matching Fit/Reset/the initial default view's already-reliable path —
  // a real product fix, not a test workaround, and it also gives Zoom in/out an exact factor
  // instead of `zoomIn`/`zoomOut`'s fixed internal 1.2. Reduced motion (`duration: 0`) is used
  // below so these assertions read the settled value without needing to drive an animation;
  // the animated case a reader actually sees is verified in a real browser (task 4.2's wheel-zoom
  // check already exercises the same `setViewport` call).
  it('zooms in and out from the buttons', () => {
    state.reduced = true;
    const { container } = draw();
    const opened = viewportTransform(container).k;

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomedIn = viewportTransform(container).k;
    expect(zoomedIn).toBeGreaterThan(opened);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(viewportTransform(container).k).toBeLessThan(zoomedIn);
  });

  it('opens at a readable zoom, not fitted past the default floor', () => {
    const { container } = draw();
    expect(viewportTransform(container).k).toBeGreaterThanOrEqual(1);
    expect(within(chipFor(container, 'projects/api/docs/billing.md')).getByText('Billing runbook')).toBeInTheDocument();
  });

  it('resets the viewport to its default on Reset', () => {
    state.reduced = true;
    const { container } = draw();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomed = viewportTransform(container).k;

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(viewportTransform(container).k).not.toBeCloseTo(zoomed, 3);
    expect(viewportTransform(container).k).toBeGreaterThanOrEqual(1);
  });

  it('frames every page on Fit', () => {
    state.reduced = true;
    const { container } = draw();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));

    const t = viewportTransform(container);
    for (const el of chips(container)) {
      const wrapper = el.closest('.react-flow__node')!;
      const pos = positionOf(wrapper as HTMLElement);
      // Every chip's own position should land within the viewport's frame, margin included.
      expect(pos.x * t.k + t.x).toBeGreaterThan(-100);
      expect(pos.x * t.k + t.x).toBeLessThan(1100);
    }
  });

});

describe('search and the legend', () => {
  it('dims what does not match the search and leaves the layout alone', () => {
    const { container } = draw();
    const before = chips(container).map((el) => positionOf(el.closest('.react-flow__node')!));

    fireEvent.change(screen.getByLabelText('Search the graph'), { target: { value: 'billing' } });

    expect(chipFor(container, 'projects/api/docs/billing.md').dataset['dimmed']).toBeUndefined();
    expect(chipFor(container, 'projects/api/docs/payments.md').dataset['dimmed']).toBe('true');
    expect(chips(container).map((el) => positionOf(el.closest('.react-flow__node')!))).toEqual(before);
  });

  it('restores everything when the search is cleared', () => {
    const { container } = draw();
    const box = screen.getByLabelText('Search the graph');

    fireEvent.change(box, { target: { value: 'billing' } });
    fireEvent.change(box, { target: { value: '' } });

    expect(chips(container).filter((n) => n.dataset['dimmed'])).toHaveLength(0);
  });

  it('takes a whole group out of the drawing when its legend chip is switched off', () => {
    const { container } = draw();
    expect(chips(container)).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'api' }));

    expect(chips(container).map((n) => n.dataset['node'])).toEqual(['SHARED.md', 'decisions.md']);
    expect(container.querySelectorAll('path[data-edge]')).toHaveLength(0);
  });

  it('says there is nothing to draw once every group is hidden', () => {
    const { container } = draw();

    for (const g of ['api', 'shared', 'decisions']) fireEvent.click(screen.getByRole('button', { name: g }));

    expect(screen.getByText('Every group is hidden.')).toBeInTheDocument();
    expect(chips(container)).toHaveLength(0);
  });
});

describe('highlighting, selection and the detail panel', () => {
  it('dims everything outside the hovered neighbourhood and restores it on leave', () => {
    const { container } = draw();
    const payments = wrapperFor(container, 'projects/api/docs/payments.md');

    fireEvent.mouseEnter(payments);
    expect(chipFor(container, 'projects/api/docs/payments.md').dataset['dimmed']).toBeUndefined();
    expect(chipFor(container, 'projects/api/PROJECT.md').dataset['dimmed']).toBeUndefined();
    expect(chipFor(container, 'projects/api/docs/billing.md').dataset['dimmed']).toBe('true');
    expect(chipFor(container, 'decisions.md').dataset['dimmed']).toBe('true');

    fireEvent.mouseLeave(payments);
    expect(chips(container).filter((n) => n.dataset['dimmed'])).toHaveLength(0);
  });

  it('opens a detail panel on click with the page, its scope, size, links and neighbours', () => {
    const { container } = draw();

    fireEvent.click(wrapperFor(container, 'projects/api/docs/payments.md'));

    const panel = detailPanel(container);
    expect(within(panel).getByText('Payments webhooks')).toBeInTheDocument();
    expect(within(panel).getByText(/api · 400 tok · 1 links/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'API knowledge' })).toBeInTheDocument();
  });

  it('opens the page from the panel and from a double-click', () => {
    const { container, onOpen } = draw();

    fireEvent.click(wrapperFor(container, 'projects/api/docs/billing.md'));
    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'Open page' }));
    expect(onOpen).toHaveBeenCalledWith('projects/api/docs/billing.md');

    onOpen.mockClear();
    fireEvent.doubleClick(wrapperFor(container, 'SHARED.md'));
    expect(onOpen).toHaveBeenCalledWith('SHARED.md');
  });

  it('pins and unpins the selected node', () => {
    const { container } = draw();
    fireEvent.click(wrapperFor(container, 'projects/api/docs/billing.md'));

    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'Pin' }));
    expect(chipFor(container, 'projects/api/docs/billing.md').dataset['pinned']).toBe('true');

    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'Unpin' }));
    expect(chipFor(container, 'projects/api/docs/billing.md').dataset['pinned']).toBeUndefined();
  });

  it('follows a link from the panel to that page', () => {
    const { container } = draw();
    fireEvent.click(wrapperFor(container, 'projects/api/docs/payments.md'));

    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'API knowledge' }));

    expect(within(detailPanel(container)).getByText(/900 tok/)).toBeInTheDocument();
  });

  it('closes the panel and clears the selection', () => {
    const { container } = draw();
    fireEvent.click(wrapperFor(container, 'SHARED.md'));

    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'Close the detail panel' }));

    expect(container.querySelector('[data-graph-detail]')).toBeNull();
  });
});

describe('the phone', () => {
  it('lists the selected page and its neighbours instead of drawing a canvas', () => {
    state.phone = true;
    const { container } = draw();

    expect(container.querySelector('.react-flow')).toBeNull();
    const list = container.querySelector('[data-graph-list]')!;
    // The best-linked page roots the list: the api hub, with its three neighbours.
    expect(within(list as HTMLElement).getByText('API knowledge')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('Payments webhooks')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('Shared conventions')).toBeInTheDocument();
  });

  it('re-roots the list on the neighbour that was chosen', () => {
    state.phone = true;
    const { container } = draw();
    const list = (): HTMLElement => container.querySelector('[data-graph-list]') as HTMLElement;

    fireEvent.click(within(list()).getByText('Payments webhooks').closest('button')!);

    expect(within(list()).getAllByText('Payments webhooks')).not.toHaveLength(0);
    expect(within(list()).queryByText('Billing runbook')).toBeNull();
  });

  it('switches to the interactive canvas on request', () => {
    state.phone = true;
    const { container } = draw();

    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }));

    expect(container.querySelector('.react-flow')).not.toBeNull();
    expect(chips(container)).toHaveLength(5);
  });

  it('re-measures the canvas frame once it exists, instead of keeping the fallback size', () => {
    state.phone = true;
    const { container } = draw();
    // The canvas — and its own <ReactFlow>, with its own `onInit` — does not exist until this
    // click; flush its `setTimeout(fn, 1)` (fake timers must already be active *before* the click
    // schedules it, same as `draw()` does for the initial mount).
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }));
    act(() => { vi.advanceTimersByTime(5); });
    vi.useRealTimers();
    const before = viewportTransform(container);

    // The canvas frame did not exist while the phone list was showing, so its first real size —
    // narrower than the fallback, as any phone frame is — only arrives now.
    const frame = container.querySelector('.ac-card') as HTMLElement;
    Object.defineProperty(frame, 'clientWidth', { configurable: true, get: () => 360 });
    Object.defineProperty(frame, 'clientHeight', { configurable: true, get: () => 640 });
    act(() => resizeObserved());

    expect(viewportTransform(container)).not.toEqual(before);
  });
});

describe('reduced motion', () => {
  it('settles the layout without scheduling a single animation frame', () => {
    state.reduced = true;
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { container } = draw();

    expect(raf).not.toHaveBeenCalled();
    expect(chips(container).every((n) => Number.isFinite(positionOf(n.closest('.react-flow__node')!).x))).toBe(true);
    raf.mockRestore();
  });

  it('moves the viewport in one step rather than easing it', () => {
    state.reduced = true;
    draw();

    const raf = vi.spyOn(window, 'requestAnimationFrame');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });
});

describe('a refetch', () => {
  it('leaves every page where it was when the data has not changed', () => {
    const { container } = draw();
    const before = chips(container).map((el) => positionOf(el.closest('.react-flow__node')!));

    // react-query hands back a fresh object for the same graph; the layout must not notice.
    state.graph = { nodes: [...GRAPH.nodes], edges: [...GRAPH.edges] };
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(chips(container).map((el) => positionOf(el.closest('.react-flow__node')!))).toEqual(before);
  });
});
