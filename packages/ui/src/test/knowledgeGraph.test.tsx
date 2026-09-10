import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraph } from '../api/types';

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

function draw(onOpen = vi.fn()): { container: HTMLElement; onOpen: ReturnType<typeof vi.fn> } {
  const { container } = render(<KnowledgeGraphView onOpen={onOpen} />);
  return { container, onOpen };
}

/** The frame the component falls back to when jsdom reports no layout. */
const FRAME = { width: 900, height: 520 };
const VIEW_TWEEN_MS = 260;

const nodes = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[data-node]')];
const detailPanel = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>('[data-graph-detail]')!;
const nodeFor = (c: HTMLElement, id: string): HTMLElement => c.querySelector<HTMLElement>(`[data-node="${id}"]`)!;
const positionOf = (el: Element): string => el.getAttribute('transform') ?? '';
const sceneTransform = (c: HTMLElement): string => c.querySelector('svg > g')!.getAttribute('transform') ?? '';

describe('the graph canvas', () => {
  it('draws one element per node and one per drawable edge, with the mutual pair collapsed', () => {
    const { container } = draw();

    expect(nodes(container)).toHaveLength(5);
    // Four link rows, but the api hub and payments cite each other: three lines.
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(3);
    const mutual = container.querySelector('[data-edge*="payments"]')!;
    expect(mutual.getAttribute('marker-end')).toBeNull();
    const oneWay = container.querySelector('[data-edge*="SHARED"]')!;
    expect(oneWay.getAttribute('marker-end')).toBe('url(#ac-graph-arrow)');
  });

  it('lays the nodes out and writes their positions onto the elements', () => {
    const { container } = draw();

    const placed = nodes(container).map(positionOf);
    expect(placed.every((t) => /^translate\(-?[\d.]+ -?[\d.]+\)$/.test(t))).toBe(true);
    expect(new Set(placed).size).toBe(5);
  });

  it('draws a cluster region per group that has more than one page', () => {
    const { container } = draw();

    const hulls = [...container.querySelectorAll('svg path[fill-opacity="0.07"]')];
    const withRegion = hulls.filter((h) => h.getAttribute('d'));
    // api has three pages; shared and decisions have one each.
    expect(withRegion).toHaveLength(1);
  });
});

describe('dragging and panning', () => {
  it('moves a node with the pointer and does not select it', () => {
    const { container } = draw();
    const node = nodeFor(container, 'projects/api/docs/billing.md');
    const before = positionOf(node);
    const svg = container.querySelector('svg')!;

    fireEvent.pointerDown(node, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 260, clientY: 210 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 260, clientY: 210 });

    expect(positionOf(node)).not.toBe(before);
    expect(container.querySelector('[data-graph-detail]')).toBeNull();
  });

  it('pans the scene when the background is dragged, moving no node', () => {
    const { container } = draw();
    const svg = container.querySelector('svg')!;
    const node = nodeFor(container, 'SHARED.md');
    const before = positionOf(node);
    const scene = sceneTransform(container);

    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 140, clientY: 90 });
    fireEvent.pointerUp(svg, { pointerId: 2, clientX: 140, clientY: 90 });

    expect(sceneTransform(container)).not.toBe(scene);
    expect(positionOf(node)).toBe(before);
  });

  it('zooms the scene on the wheel', () => {
    const { container } = draw();
    const svg = container.querySelector('svg')!;
    const before = sceneTransform(container);

    fireEvent.wheel(svg, { deltaY: -400, clientX: 200, clientY: 200 });

    const after = sceneTransform(container);
    expect(after).not.toBe(before);
    expect(scaleOf(after)).toBeGreaterThan(scaleOf(before));
  });

  it('zooms out on the opposite wheel direction', () => {
    const { container } = draw();
    const svg = container.querySelector('svg')!;
    fireEvent.wheel(svg, { deltaY: 600, clientX: 200, clientY: 200 });
    const zoomedOut = scaleOf(sceneTransform(container));

    fireEvent.wheel(svg, { deltaY: -600, clientX: 200, clientY: 200 });

    expect(scaleOf(sceneTransform(container))).toBeGreaterThan(zoomedOut);
  });

  it('zooms about the midpoint when two fingers move apart', () => {
    const { container } = draw();
    const svg = container.querySelector('svg')!;
    const before = scaleOf(sceneTransform(container));

    fireEvent.pointerDown(svg, { pointerId: 10, clientX: 200, clientY: 200 });
    fireEvent.pointerDown(svg, { pointerId: 11, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(svg, { pointerId: 11, clientX: 500, clientY: 200 });

    expect(scaleOf(sceneTransform(container))).toBeGreaterThan(before);
    fireEvent.pointerUp(svg, { pointerId: 10, clientX: 200, clientY: 200 });
    fireEvent.pointerUp(svg, { pointerId: 11, clientX: 500, clientY: 200 });
  });

  it('shortens the labels far out and shows them in full close in', () => {
    const { container } = draw();
    const svg = container.querySelector('svg')!;
    const labelled = () => [...container.querySelectorAll('text')].map((t) => t.textContent);

    fireEvent.wheel(svg, { deltaY: 2000, clientX: 200, clientY: 200 });
    // Zoomed right out only the hubs stay named.
    expect(labelled()).toEqual(expect.arrayContaining(['API knowledge', 'Shared conventions', 'Decisions log']));
    expect(labelled()).not.toContain('Billing runbook');

    fireEvent.wheel(svg, { deltaY: -4000, clientX: 200, clientY: 200 });
    expect(labelled()).toContain('Billing runbook');
  });

  it('draws labeled chips rather than unmarked filled circles', () => {
    const { container } = draw();
    const chips = container.querySelectorAll('[data-chip]');
    expect(chips).toHaveLength(5);
    expect(container.querySelectorAll('[data-node] circle')).toHaveLength(0);
    expect(container.querySelector('[data-kind="hub"] text')?.getAttribute('class')).toContain('font-semibold');
    expect(container.querySelector('[data-kind="doc"] text')?.getAttribute('class')).not.toContain('font-semibold');
  });

  it('opens at a readable zoom, not fitted past the default floor', () => {
    const { container } = draw();
    expect(scaleOf(sceneTransform(container))).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('[data-node="projects/api/docs/billing.md"] text')?.textContent).toBe('Billing runbook');
  });

  it('zooms in and out from the buttons about the frame centre', () => {
    const { container } = draw();
    const opened = scaleOf(sceneTransform(container));

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const zoomedIn = scaleOf(sceneTransform(container));
    expect(zoomedIn).toBeGreaterThan(opened);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(scaleOf(sceneTransform(container))).toBeLessThan(zoomedIn);
  });

  it('eases the viewport back to its default on Reset', () => {
    const { container } = draw();
    const opened = sceneTransform(container);
    fireEvent.wheel(container.querySelector('svg')!, { deltaY: -600, clientX: 200, clientY: 200 });
    expect(sceneTransform(container)).not.toBe(opened);

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    vi.advanceTimersByTime(VIEW_TWEEN_MS * 3);
    vi.useRealTimers();

    expect(sceneTransform(container)).toBe(opened);
  });

  it('frames every page on Fit', () => {
    const { container } = draw();
    fireEvent.wheel(container.querySelector('svg')!, { deltaY: -900, clientX: 10, clientY: 10 });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    vi.advanceTimersByTime(VIEW_TWEEN_MS * 3);
    vi.useRealTimers();

    const t = sceneTransform(container);
    const k = scaleOf(t);
    const [x, y] = [...t.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
    for (const node of nodes(container)) {
      const [nx, ny] = [...positionOf(node).matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
      expect(nx! * k + x!).toBeGreaterThanOrEqual(0);
      expect(nx! * k + x!).toBeLessThanOrEqual(FRAME.width);
      expect(ny! * k + y!).toBeGreaterThanOrEqual(0);
      expect(ny! * k + y!).toBeLessThanOrEqual(FRAME.height);
    }
  });
});

function scaleOf(transform: string): number {
  return Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? 1);
}

describe('search and the legend', () => {
  it('dims what does not match the search and leaves the layout alone', () => {
    const { container } = draw();
    const before = nodes(container).map(positionOf);

    fireEvent.change(screen.getByLabelText('Search the graph'), { target: { value: 'billing' } });

    expect(nodeFor(container, 'projects/api/docs/billing.md').dataset['dimmed']).toBeUndefined();
    expect(nodeFor(container, 'projects/api/docs/payments.md').dataset['dimmed']).toBe('true');
    expect(nodes(container).map(positionOf)).toEqual(before);
  });

  it('restores everything when the search is cleared', () => {
    const { container } = draw();
    const box = screen.getByLabelText('Search the graph');

    fireEvent.change(box, { target: { value: 'billing' } });
    fireEvent.change(box, { target: { value: '' } });

    expect(nodes(container).filter((n) => n.dataset['dimmed'])).toHaveLength(0);
  });

  it('takes a whole group out of the drawing when its legend chip is switched off', () => {
    const { container } = draw();
    expect(nodes(container)).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'api' }));

    expect(nodes(container).map((n) => n.dataset['node'])).toEqual(['SHARED.md', 'decisions.md']);
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(0);
  });

  it('says there is nothing to draw once every group is hidden', () => {
    const { container } = draw();

    for (const g of ['api', 'shared', 'decisions']) fireEvent.click(screen.getByRole('button', { name: g }));

    expect(screen.getByText('Every group is hidden.')).toBeInTheDocument();
    expect(nodes(container)).toHaveLength(0);
  });
});

describe('highlighting, selection and the detail panel', () => {
  it('dims everything outside the hovered neighbourhood and restores it on leave', () => {
    const { container } = draw();
    const payments = nodeFor(container, 'projects/api/docs/payments.md');

    fireEvent.pointerEnter(payments);
    expect(payments.dataset['dimmed']).toBeUndefined();
    expect(nodeFor(container, 'projects/api/PROJECT.md').dataset['dimmed']).toBeUndefined();
    expect(nodeFor(container, 'projects/api/docs/billing.md').dataset['dimmed']).toBe('true');
    expect(nodeFor(container, 'decisions.md').dataset['dimmed']).toBe('true');

    fireEvent.pointerLeave(payments);
    expect(nodes(container).filter((n) => n.dataset['dimmed'])).toHaveLength(0);
  });

  it('opens a detail panel on click with the page, its scope, size, links and neighbours', () => {
    const { container } = draw();

    fireEvent.click(nodeFor(container, 'projects/api/docs/payments.md'));

    const panel = detailPanel(container);
    expect(within(panel).getByText('Payments webhooks')).toBeInTheDocument();
    expect(within(panel).getByText(/api · 400 tok · 1 links/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'API knowledge' })).toBeInTheDocument();
  });

  it('opens the page from the panel and from a double-click', () => {
    const { container, onOpen } = draw();

    fireEvent.click(nodeFor(container, 'projects/api/docs/billing.md'));
    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'Open page' }));
    expect(onOpen).toHaveBeenCalledWith('projects/api/docs/billing.md');

    onOpen.mockClear();
    fireEvent.doubleClick(nodeFor(container, 'SHARED.md'));
    expect(onOpen).toHaveBeenCalledWith('SHARED.md');
  });

  it('pins and unpins the selected node', () => {
    const { container } = draw();
    fireEvent.click(nodeFor(container, 'projects/api/docs/billing.md'));

    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'Pin' }));
    expect(nodeFor(container, 'projects/api/docs/billing.md').dataset['pinned']).toBe('true');

    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'Unpin' }));
    expect(nodeFor(container, 'projects/api/docs/billing.md').dataset['pinned']).toBeUndefined();
  });

  it('follows a link from the panel to that page', () => {
    const { container } = draw();
    fireEvent.click(nodeFor(container, 'projects/api/docs/payments.md'));

    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'API knowledge' }));

    expect(within(detailPanel(container)).getByText(/900 tok/)).toBeInTheDocument();
  });

  it('closes the panel and clears the selection', () => {
    const { container } = draw();
    fireEvent.click(nodeFor(container, 'SHARED.md'));

    fireEvent.click(within(detailPanel(container)).getByRole('button', { name: 'Close the detail panel' }));

    expect(container.querySelector('[data-graph-detail]')).toBeNull();
  });
});

describe('the phone', () => {
  it('lists the selected page and its neighbours instead of drawing a canvas', () => {
    state.phone = true;
    const { container } = draw();

    expect(container.querySelector('svg')).toBeNull();
    const list = container.querySelector('[data-graph-list]')!;
    // The best-linked page roots the list: the api hub, with its three neighbours.
    expect(within(list as HTMLElement).getByText('API knowledge')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('Payments webhooks')).toBeInTheDocument();
    expect(within(list as HTMLElement).getByText('Shared conventions')).toBeInTheDocument();
  });

  it('re-roots the list on the neighbour that was chosen', () => {
    state.phone = true;
    const { container } = draw();
    const list = () => container.querySelector('[data-graph-list]') as HTMLElement;

    fireEvent.click(within(list()).getByText('Payments webhooks').closest('button')!);


    expect(within(list()).getAllByText('Payments webhooks')).not.toHaveLength(0);
    expect(within(list()).queryByText('Billing runbook')).toBeNull();
  });

  it('switches to the interactive canvas on request', () => {
    state.phone = true;
    const { container } = draw();

    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }));

    expect(container.querySelector('svg')).not.toBeNull();
    expect(nodes(container)).toHaveLength(5);
  });
});

describe('reduced motion', () => {
  it('settles the layout without scheduling a single animation frame', () => {
    state.reduced = true;
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { container } = draw();

    expect(raf).not.toHaveBeenCalled();
    expect(nodes(container).every((n) => /^translate\(/.test(positionOf(n)))).toBe(true);
    raf.mockRestore();
  });

  it('moves the viewport in one step rather than easing it', () => {
    state.reduced = true;
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });
});

describe('a refetch', () => {
  it('leaves every page where it was when the data has not changed', () => {
    const { container } = render(<KnowledgeGraphView onOpen={vi.fn()} />);
    const before = nodes(container).map(positionOf);

    // react-query hands back a fresh object for the same graph; the layout must not notice.
    state.graph = { nodes: [...GRAPH.nodes], edges: [...GRAPH.edges] };
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(nodes(container).map(positionOf)).toEqual(before);
  });
});
