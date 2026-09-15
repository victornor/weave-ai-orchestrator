/** V2Page's `scroll` prop (VS-385 task 3.2, matches PR #309/VS-371's shape). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useRouterState: (o?: { select?: (s: { location: { pathname: string } }) => unknown }) =>
    (o?.select ? o.select({ location: { pathname: '/w/ws1/plugins/notes' } }) : '/w/ws1/plugins/notes'),
}));
vi.mock('../api/hooks', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme' }] }),
  useWorkersMany: () => [{ data: [] }],
  useDecisionsMany: () => [{ data: [] }],
  useIncidents: () => ({ data: { items: [] } }),
}));

const { V2Page } = await import('../v2/V2Page');

describe('V2Page scroll prop', () => {
  it('defaults to a scrolling body', () => {
    render(<V2Page title="Notes"><div>content</div></V2Page>);
    const body = screen.getByText('content').parentElement!;
    expect(body).toHaveAttribute('data-v2-page-body', 'scroll');
    expect(body.className).toContain('overflow-y-auto');
  });

  it('scroll={false} renders a non-scrolling flex frame instead', () => {
    render(<V2Page title="Notes" scroll={false}><div>content</div></V2Page>);
    const body = screen.getByText('content').parentElement!;
    expect(body).toHaveAttribute('data-v2-page-body', 'fill');
    expect(body.className).toContain('overflow-hidden');
    expect(body.className).not.toContain('overflow-y-auto');
  });
});
