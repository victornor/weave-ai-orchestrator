import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraph } from '../api/types';

/**
 * jsdom has no real 2D canvas context in this repo (no `canvas` native package installed), and
 * `react-force-graph-2d` crashes on mount trying to get one (confirmed directly: "Cannot read
 * properties of null (reading 'scale')" from `force-graph`'s own `adjustCanvasSize`). This is not
 * fixable from here — see `openspec/changes/vs-280-rebuild-the-knowledge-graph-on-a-canvas/
 * design.md` Decision 6. Instead of mounting the real thing, this mock captures the exact props
 * `KnowledgeGraphView` computes and hands to it (`graphData`, and the canvas paint / interaction
 * callbacks), so tests can assert on what the component decided to draw and simulate interactions
 * by calling those captured callbacks directly, without a real canvas anywhere.
 */
const fg = vi.hoisted(() => ({
  props: null as any,
  methods: {
    zoomToFit: vi.fn(),
    zoom: vi.fn(() => 1),
    centerAt: vi.fn(),
    d3Force: vi.fn(),
    d3ReheatSimulation: vi.fn(),
  },
}));

vi.mock('react-force-graph-2d', async () => {
  const React = await import('react');
  const ForceGraph2D = React.forwardRef((props: any, ref: any) => {
    fg.props = props;
    React.useImperativeHandle(ref, () => fg.methods);
    return React.createElement('div', { 'data-testid': 'force-graph' });
  });
  return { default: ForceGraph2D };
});

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
  fg.props = null;
  fg.methods.zoomToFit.mockClear();
  fg.methods.zoom.mockClear().mockReturnValue(1);
  fg.methods.centerAt.mockClear();
  fg.methods.d3Force.mockClear();
  fg.methods.d3ReheatSimulation.mockClear();
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

/** A recording fake `CanvasRenderingContext2D` covering only what the paint callbacks call. */
function fakeCtx(): CanvasRenderingContext2D & { calls: Array<{ op: string; alpha: number; args?: unknown[] }> } {
  const calls: Array<{ op: string; alpha: number; args?: unknown[] }> = [];
  let alpha = 1;
  const ctx = {
    calls,
    get globalAlpha() { return alpha; },
    set globalAlpha(v: number) { alpha = v; },
    beginPath: () => calls.push({ op: 'beginPath', alpha }),
    closePath: () => calls.push({ op: 'closePath', alpha }),
    arc: (...args: unknown[]) => calls.push({ op: 'arc', alpha, args }),
    fill: () => calls.push({ op: 'fill', alpha }),
    stroke: () => calls.push({ op: 'stroke', alpha }),
    moveTo: (...args: unknown[]) => calls.push({ op: 'moveTo', alpha, args }),
    lineTo: (...args: unknown[]) => calls.push({ op: 'lineTo', alpha, args }),
    fillText: (...args: unknown[]) => calls.push({ op: 'fillText', alpha, args }),
    set fillStyle(_v: string) { /* noop */ },
    set strokeStyle(_v: string) { /* noop */ },
    set lineWidth(_v: number) { /* noop */ },
    set font(_v: string) { /* noop */ },
    set textAlign(_v: string) { /* noop */ },
    set textBaseline(_v: string) { /* noop */ },
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls };
}

describe('the graph canvas', () => {
  it('hands react-force-graph-2d one node per page and one link per drawable edge, the mutual pair collapsed', () => {
    draw();

    expect(fg.props.graphData.nodes).toHaveLength(5);
    // Four link rows, but the api hub and payments cite each other: three lines.
    expect(fg.props.graphData.links).toHaveLength(3);
    const mutual = fg.props.graphData.links.find((l: { id: string }) => l.id.includes('payments'));
    expect(mutual.directed).toBe(false);
    const oneWay = fg.props.graphData.links.find((l: { id: string }) => l.id.includes('SHARED'));
    expect(oneWay.directed).toBe(true);
  });

  it('gives every node a finite position and a distinct radius by degree', () => {
    draw();
    const nodes = fg.props.graphData.nodes;
    expect(nodes.every((n: { x: number; y: number }) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    const hub = nodes.find((n: { id: string }) => n.id === 'projects/api/PROJECT.md');
    const leaf = nodes.find((n: { id: string }) => n.id === 'decisions.md');
    expect(hub.radius).toBeGreaterThan(leaf.radius);
  });

  it('hiding a group removes its node from graphData and the rest settle into the space', () => {
    draw();
    fireEvent.click(screen.getByText('decisions'));
    expect(fg.props.graphData.nodes.some((n: { id: string }) => n.id === 'decisions.md')).toBe(false);
    expect(fg.props.graphData.nodes).toHaveLength(4);
  });

  it('draws a node undimmed and its non-neighbours dimmed once it is hovered', () => {
    draw();
    act(() => { fg.props.onNodeHover({ id: 'projects/api/PROJECT.md' }); });
    act(() => { fg.props.onRenderFramePre(); });

    const hubNode = fg.props.graphData.nodes.find((n: { id: string }) => n.id === 'projects/api/PROJECT.md');
    const decisionsNode = fg.props.graphData.nodes.find((n: { id: string }) => n.id === 'decisions.md');

    const ctxHub = fakeCtx();
    fg.props.nodeCanvasObject(hubNode, ctxHub, 1);
    const fillHub = ctxHub.calls.find((c) => c.op === 'fill');
    expect(fillHub!.alpha).toBe(1);

    const ctxDecisions = fakeCtx();
    fg.props.nodeCanvasObject(decisionsNode, ctxDecisions, 1);
    const fillDecisions = ctxDecisions.calls.find((c) => c.op === 'fill');
    expect(fillDecisions!.alpha).toBeCloseTo(0.22);
  });

  it('draws no label below the low zoom threshold unless the node is a hub, hovered or selected', () => {
    draw();
    const doc = fg.props.graphData.nodes.find((n: { id: string }) => n.id === 'projects/api/docs/billing.md');
    const hub = fg.props.graphData.nodes.find((n: { id: string }) => n.id === 'projects/api/PROJECT.md');

    const ctxDoc = fakeCtx();
    fg.props.nodeCanvasObject(doc, ctxDoc, 0.3);
    expect(ctxDoc.calls.some((c) => c.op === 'fillText')).toBe(false);

    const ctxHub = fakeCtx();
    fg.props.nodeCanvasObject(hub, ctxHub, 0.3);
    expect(ctxHub.calls.some((c) => c.op === 'fillText')).toBe(true);
  });

  it('trims an edge to the target circle\'s boundary rather than its centre', () => {
    draw();
    const s = { id: 'a', x: 0, y: 0, radius: 5 };
    const t = { id: 'b', x: 100, y: 0, radius: 8 };
    const ctx = fakeCtx();
    fg.props.linkCanvasObject({ id: 'a b', source: s, target: t, directed: true }, ctx);
    const move = ctx.calls.find((c) => c.op === 'moveTo')!;
    const line = ctx.calls.find((c) => c.op === 'lineTo')!;
    expect(move.args).toEqual([5, 0]);
    expect((line.args as number[])[0]).toBeLessThan(100);
  });

  it('selecting a node opens the detail panel; double-clicking it opens the page', () => {
    const { container, onOpen } = draw();
    const node = { id: 'projects/api/docs/payments.md' };

    act(() => { fg.props.onNodeClick(node); });
    expect(container.querySelector('[data-graph-detail]')).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();

    act(() => { fg.props.onNodeClick(node); });
    expect(onOpen).toHaveBeenCalledWith('projects/api/docs/payments.md');
  });

  it('pinning a node from the detail panel fixes its position and reheats the simulation', () => {
    draw();
    act(() => { fg.props.onNodeClick({ id: 'projects/api/docs/payments.md' }); });

    fireEvent.click(screen.getByText('Pin'));

    const pinned = fg.props.graphData.nodes.find((n: { id: string }) => n.id === 'projects/api/docs/payments.md');
    expect(pinned.fx).toBe(pinned.x);
    expect(fg.methods.d3ReheatSimulation).toHaveBeenCalled();
  });

  it('a search that lands on exactly one page centres the view on it', () => {
    draw();
    fireEvent.change(screen.getByLabelText('Search the graph'), { target: { value: 'Billing' } });
    expect(fg.methods.centerAt).toHaveBeenCalled();
  });

  it('never leaves react-force-graph-2d mounted on a phone showing the neighbour list', () => {
    state.phone = true;
    const { container } = draw();
    expect(container.querySelector('[data-graph-list]')).toBeTruthy();
    expect(screen.queryByTestId('force-graph')).toBeNull();
  });
});
