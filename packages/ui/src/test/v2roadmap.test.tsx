/**
 * VS-478: the V2 project Roadmap page (`/w/:ws/p/:project/roadmap`) — blocks with their pending
 * tickets and ticket links, the loose items, and the empty state that seeds the chat.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  project: { id: 'p1', slug: 'web', name: 'Web', gitUrl: 'git@example.invalid:web.git', defaultBranch: 'main', status: 'ready', policies: {} },
  param: 'web' as string,
  blocks: [] as Array<Record<string, unknown>>,
  items: [] as Array<Record<string, unknown>>,
  seeded: null as string | null,
  went: null as string | null,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => '/w/ws1/p/web/roadmap',
  useParams: () => ({ ws: 'ws1', project: state.param }),
}));

vi.mock('../app/link', () => ({
  A: ({ to, params, children, ...rest }: { to: string; params?: Record<string, unknown>; children?: ReactNode } & Record<string, unknown>) => (
    <a href={to.replace(/\$ws/g, String(params?.['ws'] ?? '')).replace(/\$project/g, String(params?.['project'] ?? '')).replace(/\$ticketId/g, String(params?.['ticketId'] ?? ''))} {...rest}>
      {children}
    </a>
  ),
  useGo: () => (to: string) => { state.went = to; },
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1', useHookWs: (o?: string) => o ?? 'ws1' }));

vi.mock('../lib/drafts', () => ({
  seedDraft: (_ws: string, text: string) => { state.seeded = text; },
}));

vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme', needsYou: 0 }] }),
  useWorkers: () => ({ data: [] }),
  useWorkersMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useDecisionsMany: (ids: readonly string[]) => ids.map(() => ({ data: [] })),
  useIncidents: () => ({ data: { items: [] } }),
  useProjects: () => ({ data: [state.project], isLoading: false }),
  useRoadmapBlocks: () => ({ isLoading: false, data: state.blocks }),
  useRoadmap: () => ({ isLoading: false, data: state.items }),
  useTickets: () => ({ isLoading: false, data: [{ id: 'tk_1', identifier: 'ACME-42' }] }),
}));

const { V2RoadmapScreen } = await import('../v2/project/RoadmapPage');

beforeEach(() => {
  state.param = 'web';
  state.blocks = [];
  state.items = [];
  state.seeded = null;
  state.went = null;
});

describe('V2 roadmap page (VS-478)', () => {
  it('renders blocks in order with their pending tickets, then the loose items', () => {
    state.blocks = [
      {
        id: 'b1', projectId: 'p1', title: 'UI polish', notes: '', position: 0, status: 'started', reportedStatus: 'started', startedAt: 't0', items: [
          { id: 'i1', workspaceId: 'ws1', projectId: 'p1', blockId: 'b1', title: 'Tidy the button', notes: '', description: 'Do it.\n\n## Acceptance\n- one size', kind: 'task', priority: 'high', roleId: null, position: 0, status: 'planned', ticketId: 'tk_1' },
          { id: 'i2', workspaceId: 'ws1', projectId: 'p1', blockId: 'b1', title: 'Fix the label', notes: '', description: '', kind: 'change', priority: 'medium', roleId: null, position: 1, status: 'planned', ticketId: null },
        ],
      },
      { id: 'b2', projectId: 'p1', title: 'Docs', notes: '', position: 1, status: 'open', reportedStatus: 'open', startedAt: null, items: [] },
    ];
    state.items = [
      { id: 'i1', workspaceId: 'ws1', projectId: 'p1', blockId: 'b1', title: 'Tidy the button', notes: '', description: '', kind: 'task', priority: 'high', roleId: null, position: 0, status: 'planned', ticketId: 'tk_1' },
      { id: 'i3', workspaceId: 'ws1', projectId: 'p1', blockId: null, title: 'A loose idea', notes: '**later**', description: '', kind: 'change', priority: 'medium', roleId: null, position: 2, status: 'idea', ticketId: null },
    ];
    render(<V2RoadmapScreen />);

    const blockHeads = screen.getAllByRole('heading', { level: 2 })
      .filter((h) => !h.closest('.v2-md-compact'))
      .map((h) => h.textContent);
    expect(blockHeads).toEqual(['UI polish', 'Docs', 'Loose items']);
    const polish = screen.getByRole('heading', { name: 'UI polish' }).closest('section') as HTMLElement;
    expect(within(polish).getByText('Tidy the button')).toBeInTheDocument();
    expect(within(polish).getByText('TASK')).toBeInTheDocument();
    expect(within(polish).getByText('high')).toBeInTheDocument();
    // A description's markdown headings render inside the compact scope, so they read at card
    // scale rather than page-heading scale (VS-478 review).
    expect(within(polish).getByRole('heading', { name: 'Acceptance' }).closest('.v2-md-compact')).not.toBeNull();
    expect(within(polish).getByRole('link', { name: 'ACME-42' })).toHaveAttribute('href', '/w/ws1/tickets/ACME-42');
    expect(screen.getByText('A loose idea')).toBeInTheDocument();
    // Read-only: no create/edit controls on the page.
    expect(screen.queryByLabelText('Add a roadmap idea')).toBeNull();
  });

  it('shows the empty state and its action seeds the chat', () => {
    render(<V2RoadmapScreen />);
    expect(screen.getByText('No roadmap yet.')).toBeInTheDocument();
    expect(screen.getByText('Ask the weaver about roadmaps.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the weaver about roadmaps' }));
    expect(state.seeded).toBe('Tell me how roadmap blocks save tokens, and how to use them on this project.');
    expect(state.went).toBe('/w/ws1/chat');
  });

  it('shows the unknown-project state', () => {
    state.param = 'ghost';
    render(<V2RoadmapScreen />);
    expect(screen.getByText('No such project in this workspace.')).toBeInTheDocument();
  });
});
