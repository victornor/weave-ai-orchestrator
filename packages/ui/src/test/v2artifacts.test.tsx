/** V2 artifact rendering: the inline panel split, and the two full-screen readers. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agent, project, ticket, workProduct } from './factories';

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  notFound: false,
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => state.params,
}));
vi.mock('../app/link', () => ({
  A: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: React.ReactNode }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, String(v));
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

const detail = {
  ticket: ticket({ id: 'tk_42', identifier: 'ACME-42' }),
  project: project({ id: 'p1', slug: 'web', name: 'web' }),
  worker: agent({ id: 'a1', name: 'Backend Engineer #7' }),
  role: null,
  blockers: [],
  children: [],
  documents: [{ key: 'artifact:overview', revision: 1, updatedAt: '2026-09-01T00:00:00.000Z' }],
  workProducts: [],
  openspecState: null,
  mergeQueue: { position: null, concurrency: 1 },
};

vi.mock('../api/hooks', () => ({
  useTicket: () => (state.notFound ? { data: undefined, isLoading: false, isError: true } : { data: detail, isLoading: false, isError: false }),
  useTicketWorkProducts: () => ({
    data: [workProduct({ id: 'wp1', type: 'artifact', externalId: 'overview', title: 'How theming resolves', url: '/api/w/ws1/tickets/tk_42/artifacts/overview/raw' })],
    isLoading: false,
  }),
  useTicketDocumentRevisions: () => ({ data: [] }),
  useWorkspaceArtifacts: () => ({
    data: state.notFound ? [] : [{ key: 'overview', title: 'Workspace overview', kind: 'diagram', revision: 1, updatedAt: '2026-09-01T00:00:00.000Z' }],
    isLoading: false,
  }),
  useWorkspaceArtifactRevisions: () => ({ data: [] }),
  usePlanArtifacts: () => ({
    data: state.notFound ? [] : [{ key: 'overview', title: 'Plan overview', kind: 'diagram', revision: 1, updatedAt: '2026-09-01T00:00:00.000Z' }],
    isLoading: false,
  }),
  usePlanArtifactRevisions: () => ({ data: [] }),
}));

const { ArtifactInline, V2TicketArtifactReader, V2WorkspaceArtifactReader, V2PlanArtifactReader, splitArtifacts } = await import('../v2/artifact/Artifact');

beforeEach(() => {
  state.params = { ws: 'ws1', ticketId: 'ACME-42', key: 'overview' };
  state.notFound = false;
});

describe('splitting a ticket artifact list', () => {
  it('keeps a stored artifact and marks a link-only one', () => {
    const stored = workProduct({ id: 'wp1', type: 'artifact', externalId: 'overview' });
    const linkOnly = workProduct({ id: 'wp2', type: 'artifact', externalId: 'gone' });
    const { previewable, linkOnly: rest } = splitArtifacts(detail as never, [stored, linkOnly]);
    expect(previewable.map((p) => p.id)).toEqual(['wp1']);
    expect(rest.map((p) => p.id)).toEqual(['wp2']);
  });
});

describe('the V2 ticket artifact reader', () => {
  it('shows the ticket context in its header and renders the sandboxed frame', () => {
    render(<V2TicketArtifactReader />);
    expect(screen.getByText('How theming resolves')).toBeInTheDocument();
    expect(screen.getByText('ACME-42')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getByText(/Backend Engineer #7/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Ticket' });
    expect(link).toHaveAttribute('href', '/w/ws1/tickets/ACME-42');
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(screen.getByText(/sandboxed frame/)).toBeInTheDocument();
  });

  it('says not found for an unknown key', () => {
    state.params = { ws: 'ws1', ticketId: 'ACME-42', key: 'missing' };
    render(<V2TicketArtifactReader />);
    expect(screen.getByText('Artifact not found.')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('the V2 workspace artifact reader', () => {
  it('renders a workspace artifact Knowledge can link to', () => {
    state.params = { ws: 'ws1', key: 'overview' };
    render(<V2WorkspaceArtifactReader />);
    expect(screen.getByText('Workspace overview')).toBeInTheDocument();
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toContain('/api/w/ws1/artifacts/overview/raw');
  });

  it('says not found for an unknown key', () => {
    state.params = { ws: 'ws1', key: 'missing' };
    state.notFound = true;
    render(<V2WorkspaceArtifactReader />);
    expect(screen.getByText('Artifact not found.')).toBeInTheDocument();
  });
});

describe('the V2 plan artifact reader (VS-622)', () => {
  it('renders a planner-published plan artifact through the sandboxed plan raw route', () => {
    state.params = { ws: 'ws1', planId: 'plan_1', key: 'overview' };
    render(<V2PlanArtifactReader />);
    expect(screen.getByText('Plan overview')).toBeInTheDocument();
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('src')).toContain('/api/w/ws1/plans/plan_1/artifacts/overview/raw');
  });

  it('says not found for a key that belongs to no artifact of this plan', () => {
    state.params = { ws: 'ws1', planId: 'plan_1', key: 'missing' };
    state.notFound = true;
    render(<V2PlanArtifactReader />);
    expect(screen.getByText('Artifact not found.')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('the inline artifact panel', () => {
  it('lets the reader choose among several and keys the frame and the link to the choice', () => {
    const detail2 = {
      ...detail,
      documents: [
        { key: 'artifact:overview', revision: 1, updatedAt: '' },
        { key: 'artifact:second', revision: 1, updatedAt: '' },
      ],
    };
    const products = [
      workProduct({ id: 'a', type: 'artifact', externalId: 'overview', title: 'Overview', url: '/api/w/ws1/tickets/tk_42/artifacts/overview/raw' }),
      workProduct({ id: 'b', type: 'artifact', externalId: 'second', title: 'Second', url: '/api/w/ws1/tickets/tk_42/artifacts/second/raw' }),
    ];
    render(<ArtifactInline ws="ws1" ticketId="tk_42" detail={detail2 as never} products={products} />);

    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toContain('/artifacts/overview/raw');
    fireEvent.click(document.querySelector('[data-v2-artifact-choice="second"]') as HTMLElement);
    expect((document.querySelector('iframe') as HTMLIFrameElement).getAttribute('src')).toContain('/artifacts/second/raw');
    expect(screen.getByRole('link', { name: 'Open full' }).getAttribute('href')).toContain('/artifacts/second');
  });
});
