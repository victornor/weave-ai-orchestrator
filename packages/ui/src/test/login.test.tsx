import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
vi.mock('../api/hooks', () => ({
  useHealth: () => ({
    data: { version: 'abc1234def', tlsMode: 'none', operatorConfigured: false, workspaces: [] },
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  }),
  useMe: () => ({ isSuccess: false, data: undefined }),
}));

const { LoginRoute } = await import('../routes/Login');

describe('Login brand mark', () => {
  it('shows the mark beside the wordmark, hidden because the heading names it', () => {
    const { container } = render(<LoginRoute />);
    const mark = container.querySelector('svg[aria-hidden="true"]');
    expect(mark).not.toBeNull();
    expect(mark!.querySelectorAll('path')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Weave AI' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Weave' })).not.toBeInTheDocument();
  });
});

describe('Login footer', () => {
  it('shows the git sha, not v0.1.0', () => {
    render(<LoginRoute />);
    expect(screen.getByText(/abc1234def · none/)).toBeInTheDocument();
    expect(screen.queryByText(/v0\.1\.0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/vabc1234def/)).not.toBeInTheDocument();
  });
});
