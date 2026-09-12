/**
 * VS-287: the daemon-wide Needs you page has no WorkspaceProvider, so any hook in its subtree that
 * reaches for the provider throws `useWorkspace outside WorkspaceProvider` and takes the page down.
 *
 * Unlike `globalNeeds.test.tsx` (which mocks `../api/hooks` and `../api/context` and therefore
 * cannot see such a hook), this file mounts the real route with the real hooks and the real
 * workspace context, mocking only the HTTP client. No `WorkspaceProvider` is mounted, so a real
 * `useWorkspace` still throws; the error boundary below turns that into a failed assertion rather
 * than a page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { Component } from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision } from '@weave-ai/shared';
import { decision } from './factories';

const state = vi.hoisted(() => ({
  remembered: 'beta',
  workspaces: [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ] as Array<{ id: string; name: string }>,
  decisions: {} as Record<string, unknown[] | undefined>,
  rootCalls: [] as string[],
  wsCalls: [] as Array<{ workspace: string; path: string }>,
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getWorkspaceId: () => state.remembered,
    setWorkspaceId: (id: string) => { state.remembered = id; },
    api: {
      qs: actual.qs,
      root: (path: string) => {
        state.rootCalls.push(path);
        if (path === '/workspaces') return Promise.resolve(state.workspaces);
        return Promise.resolve({});
      },
      ws: (workspace: string, path: string) => {
        state.wsCalls.push({ workspace, path });
        if (path.startsWith('/decisions')) return Promise.resolve(state.decisions[workspace] ?? []);
        if (path.includes('/documents/by-id/')) return Promise.resolve({ body: `Document in ${workspace}`, revision: 2, currentRevision: 2 });
        if (path.includes('/documents/')) return Promise.resolve({ body: `Plan in ${workspace}`, revision: 1 });
        if (path.startsWith('/tickets')) return Promise.resolve([]);
        if (path.startsWith('/projects')) return Promise.resolve([]);
        return Promise.resolve({});
      },
    },
  };
});

vi.mock('../app/link', () => ({
  useGo: () => vi.fn(),
  A: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock('../lib/queue', () => ({ enqueue: vi.fn(), useQueue: () => [] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));

const { GlobalNeedsRoute } = await import('../routes/GlobalNeeds');
const { clearHiddenCache } = await import('../lib/hiddenDecisions');

const asked = (over: Partial<Decision> = {}): Decision =>
  decision({
    id: 'd1', ticketId: 'tk_1', title: 'A decision',
    options: [{ key: 'yes', label: 'Yes' }],
    ...over,
  });

const errors: unknown[] = [];

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown): void {
    errors.push(error);
  }
  render(): ReactNode {
    return this.state.failed ? <div>render error</div> : this.props.children;
  }
}

function mount(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Boundary>
        <GlobalNeedsRoute />
      </Boundary>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.remembered = 'beta';
  state.workspaces = [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' },
  ];
  state.decisions = {};
  state.rootCalls = [];
  state.wsCalls = [];
  errors.length = 0;
  localStorage.clear();
  localStorage.setItem('conductor.ws', 'beta');
  clearHiddenCache();
});

describe('GlobalNeedsRoute without a WorkspaceProvider (VS-287)', () => {
  it('renders a plan approval and a document-targeted decision with no provider', async () => {
    state.decisions = {
      alpha: [asked({ id: 'd_plan', kind: 'plan_approval', ticketId: 'tk_alpha', title: 'Approve the plan' })],
      beta: [asked({ id: 'd_doc', kind: 'question', ticketId: 'tk_beta', title: 'Read the doc', target: { documentId: 'doc_1', revision: 2 } })],
    };
    mount();

    expect(await screen.findByText('Approve the plan')).toBeInTheDocument();
    expect(await screen.findByText('Read the doc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read the plan/ })).toBeInTheDocument();
    // The document preview opens on an open decision and reads the document in its own workspace.
    expect(await screen.findByText('Document in beta')).toBeInTheDocument();

    expect(errors).toEqual([]);
    expect(screen.queryByText('render error')).not.toBeInTheDocument();
  });

  it('loads each preview from the decision\'s own workspace, not the remembered one', async () => {
    // The remembered workspace is beta, but the plan card belongs to alpha.
    state.decisions = {
      alpha: [asked({ id: 'd_plan', kind: 'plan_approval', ticketId: 'tk_alpha', title: 'Approve the plan' })],
      beta: [asked({ id: 'd_doc', kind: 'question', ticketId: 'tk_beta', title: 'Read the doc', target: { documentId: 'doc_1', revision: 2 } })],
    };
    mount();

    await screen.findByText('Approve the plan');
    expect(screen.getByRole('button', { name: /Read the plan/ })).toBeInTheDocument();

    expect(state.wsCalls).toContainEqual({ workspace: 'alpha', path: expect.stringContaining('/tickets/tk_alpha/documents/plan') });
    expect(state.wsCalls).toContainEqual({ workspace: 'beta', path: expect.stringContaining('/tickets/tk_beta/documents/by-id/doc_1') });
    // Nothing requested the plan from the remembered (beta) workspace.
    expect(state.wsCalls.some((c) => c.workspace === 'beta' && c.path.includes('/documents/plan'))).toBe(false);
    expect(errors).toEqual([]);
  });

  it('expands the plan preview and shows the plan it loaded from its own workspace', async () => {
    state.decisions = {
      alpha: [asked({ id: 'd_plan', kind: 'plan_approval', ticketId: 'tk_alpha', title: 'Approve the plan' })],
    };
    mount();

    const read = await screen.findByRole('button', { name: /Read the plan/ });
    fireEvent.click(read);
    expect(screen.getByText('Plan in alpha')).toBeInTheDocument();
    expect(errors).toEqual([]);
  });
});
