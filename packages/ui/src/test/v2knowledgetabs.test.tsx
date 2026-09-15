/**
 * VS-371: the V2 Knowledge tab row — Knowledge · Explorer · Changelog · Graph · Specs, in V1's order,
 * each a link to its own address and carrying the chosen project, so a tab switch keeps the scope and
 * reload / back / forward land on the same tab.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const linkState = vi.hoisted(() => ({ search: {} as Record<string, string | undefined>, go: vi.fn() }));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../api/hooks', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('../app/link', () => ({
  A: ({ to, params, search, children, ...rest }: { to: string; params?: Record<string, unknown>; search?: Record<string, string>; children?: ReactNode } & Record<string, unknown>) => {
    const href = Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, String(v)), to);
    const qs = search && Object.keys(search).length ? `?${new URLSearchParams(search).toString()}` : '';
    return <a href={`${href}${qs}`} {...rest}>{children}</a>;
  },
  useSearchParams: () => linkState.search,
  useGo: () => linkState.go,
}));

const { KnowledgeTabs, KNOWLEDGE_TABS } = await import('../v2/knowledge/KnowledgeFrame');

beforeEach(() => {
  linkState.search = {};
  linkState.go = vi.fn();
});

describe('the V2 Knowledge tab row', () => {
  it('offers the five views in V1\u2019s order', () => {
    render(<KnowledgeTabs current="knowledge" />);
    expect(KNOWLEDGE_TABS.map((t) => t.key)).toEqual(['knowledge', 'explorer', 'changelog', 'graph', 'specs']);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Knowledge', 'Explorer', 'Changelog', 'Graph', 'Specs']);
  });

  it('reaches Explorer and Graph at their existing addresses, and the new tabs at theirs', () => {
    render(<KnowledgeTabs current="knowledge" />);
    expect(screen.getByRole('link', { name: 'Knowledge' })).toHaveAttribute('href', '/w/ws1/knowledge');
    expect(screen.getByRole('link', { name: 'Explorer' })).toHaveAttribute('href', '/w/ws1/knowledge/explorer');
    expect(screen.getByRole('link', { name: 'Changelog' })).toHaveAttribute('href', '/w/ws1/knowledge/changelog');
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute('href', '/w/ws1/knowledge/graph');
    expect(screen.getByRole('link', { name: 'Specs' })).toHaveAttribute('href', '/w/ws1/knowledge/specs');
  });

  it('marks the current tab and carries the project scope into every link', () => {
    linkState.search = { project: 'p1' };
    render(<KnowledgeTabs current="explorer" />);
    const explorer = screen.getByRole('link', { name: 'Explorer' });
    expect(explorer).toHaveAttribute('aria-current', 'page');
    expect(explorer).toHaveAttribute('href', '/w/ws1/knowledge/explorer?project=p1');
    expect(screen.getByRole('link', { name: 'Knowledge' })).not.toHaveAttribute('aria-current');
  });

  it('renders its view again after a remount', () => {
    const { unmount } = render(<KnowledgeTabs current="graph" />);
    expect(screen.getByRole('link', { name: 'Graph' })).toHaveAttribute('aria-current', 'page');
    unmount();
    render(<KnowledgeTabs current="specs" />);
    expect(screen.getByRole('link', { name: 'Specs' })).toHaveAttribute('aria-current', 'page');
  });
});
