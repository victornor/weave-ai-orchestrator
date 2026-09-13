/** The V2 knowledge graph route (VS-347): the V1 canvas graph is reached inside the V2 frame.
 * `react-force-graph-2d` is mocked exactly as `knowledgeGraph.test.tsx` does — jsdom has no 2D canvas
 * context — so the assertion is that the route renders and hands the graph its nodes. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Ref } from 'react';
import type { KnowledgeGraph } from '../api/types';

const fg = vi.hoisted(() => ({
  props: null as { graphData?: { nodes: unknown[] } } | null,
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
  const ForceGraph2D = React.forwardRef((props: unknown, ref: Ref<unknown>) => {
    fg.props = props as typeof fg.props;
    React.useImperativeHandle(ref, () => fg.methods);
    return React.createElement('div', { 'data-testid': 'force-graph' });
  });
  return { default: ForceGraph2D };
});

const GRAPH: KnowledgeGraph = {
  nodes: [
    { id: 'projects/web/PROJECT.md', kind: 'hub', scope: 'project', projectId: 'p1', projectSlug: 'web', slug: null, title: 'web knowledge', tokens: 900, updatedAt: '' },
    { id: 'projects/web/docs/theming.md', kind: 'doc', scope: 'project', projectId: 'p1', projectSlug: 'web', slug: 'theming', title: 'Theming', tokens: 300, updatedAt: '' },
  ],
  edges: [{ from: 'projects/web/PROJECT.md', to: 'projects/web/docs/theming.md' }],
};

vi.mock('../api/context', () => ({ useWs: () => 'acme' }));
vi.mock('../app/link', () => ({
  A: ({ to, children }: { to: string; children?: React.ReactNode }) => <a href={to}>{children}</a>,
  useSearchParams: () => ({}),
}));
vi.mock('../api/hooks', () => ({
  useKnowledgeGraph: () => ({ data: GRAPH, isLoading: false, isError: false, refetch: vi.fn() }),
  useProjects: () => ({ data: [{ id: 'p1', slug: 'web', name: 'web' }] }),
  useKnowledgeDoc: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
  useKnowledgeDocDetail: () => ({ data: null, isLoading: false, isError: true }),
  useKnowledgeDocMutation: () => ({ mutate: vi.fn() }),
  useKnowledgeMoveDoc: () => ({ mutate: vi.fn() }),
  useKnowledgeRevisions: () => ({ data: [] }),
  useKnowledgeMutation: () => ({ mutate: vi.fn() }),
}));

const { KnowledgeGraphPage } = await import('../v2/knowledge/KnowledgeGraphPage');

describe('the V2 knowledge graph route', () => {
  it('renders the force graph with one node per page and its links', async () => {
    render(<KnowledgeGraphPage />);
    expect(await screen.findByTestId('force-graph')).toBeInTheDocument();
    expect(fg.props?.graphData?.nodes).toHaveLength(2);
  });
});
