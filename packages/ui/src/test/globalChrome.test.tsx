/**
 * VS-184: AppShell on a global page has no WorkspaceProvider. A hook that still calls useWs()
 * throws "useWorkspace outside WorkspaceProvider" — this file mounts real context so that throw
 * is visible. Do not mock ../api/context or useTransitionTicket here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = vi.hoisted(() => ({ current: '/needs' }));

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => null,
  useRouterState: () => path.current,
}));
vi.mock('../app/link', () => ({
  A: ({ to, params, search, children, ...rest }: { to: string; params?: Record<string, string>; search?: Record<string, unknown>; children: React.ReactNode }) => (
    <a
      href={Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to)}
      data-search={search ? JSON.stringify(search) : undefined}
      {...rest}
    >
      {children}
    </a>
  ),
  useGo: () => () => undefined,
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../app/MoreSheet', () => ({ MoreSheet: () => null }));
vi.mock('../app/BottomBar', () => ({
  BottomBar: () => <button type="button" aria-label="bar stand-in" />,
}));
vi.mock('../lib/queue', () => ({ flushQueue: vi.fn(), useQueueCount: () => 0 }));
vi.mock('../lib/hotkeys', () => ({ useHotkeys: () => undefined }));
vi.mock('../api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/hooks')>();
  return {
    ...actual,
    useDaemonUpdate: () => ({ data: undefined, isError: false }),
    useDaemonUpgrade: () => ({ data: { upgrade: null, waitingFor: [] }, isError: false }),
    useDecisions: () => ({ data: [] }),
    useWorkspaceProjects: () => ({}),
    useTickets: () => ({ data: [] }),
    useWorkspaceSummary: () => ({ data: undefined, isError: false, error: null, refetch: vi.fn() }),
    useWorkspaces: () => ({ data: [], isError: false, refetch: vi.fn() }),
    useDaemonModels: () => ({ data: { conductor: null, workers: null, workerOptions: null }, isLoading: false }),
  };
});

const { AppShell } = await import('../app/AppShell');

beforeEach(() => {
  path.current = '/needs';
  localStorage.clear();
  localStorage.setItem('conductor.ws', 'kept');
});

function mount(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AppShell>
        <div>global body</div>
      </AppShell>
    </QueryClientProvider>,
  );
}

describe('AppShell on a global page (VS-184)', () => {
  it('renders /needs without a WorkspaceProvider and does not rewrite conductor.ws', () => {
    expect(() => mount()).not.toThrow();
    expect(screen.getByText('global body')).toBeInTheDocument();
    expect(localStorage.getItem('conductor.ws')).toBe('kept');
  });

  it.each(['/live', '/chats', '/incidents', '/map'] as const)(
    'renders %s the same way',
    (pathname) => {
      path.current = pathname;
      expect(() => mount()).not.toThrow();
      expect(screen.getByText('global body')).toBeInTheDocument();
      expect(localStorage.getItem('conductor.ws')).toBe('kept');
    },
  );
});
